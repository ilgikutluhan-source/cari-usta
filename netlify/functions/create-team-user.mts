import type { Config, Context } from '@netlify/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminServices, readFirebaseAdminSecrets } from '../lib/firebase-admin.js';

const maxBodyLength = 8192;

function response(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== 'POST') {
    return response({ error: 'method_not_allowed' }, 405);
  }

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return response({ error: 'origin_not_allowed' }, 403);
      }
    } catch {
      return response({ error: 'origin_not_allowed' }, 403);
    }
  }

  const authorization = request.headers.get('authorization') ?? '';
  const tokenMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!tokenMatch) return response({ error: 'unauthorized' }, 401);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return response({ error: 'json_required' }, 415);
  }

  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch {
    return response({ error: 'invalid_request' }, 400);
  }
  if (bodyText.length > maxBodyLength) return response({ error: 'request_too_large' }, 413);

  let input: unknown;
  try {
    input = JSON.parse(bodyText);
  } catch {
    return response({ error: 'invalid_json' }, 400);
  }
  if (!input || typeof input !== 'object') return response({ error: 'invalid_request' }, 400);

  const fields = input as Record<string, unknown>;
  const displayName = typeof fields.displayName === 'string' ? fields.displayName.trim() : '';
  const email = typeof fields.email === 'string' ? fields.email.trim().toLowerCase() : '';
  const password = typeof fields.password === 'string' ? fields.password : '';
  if (displayName.length < 2 || displayName.length > 80) {
    return response({ error: 'invalid_display_name' }, 400);
  }
  if (!isValidEmail(email)) return response({ error: 'invalid_email' }, 400);
  if (password.length < 12 || password.length > 128) {
    return response({ error: 'invalid_password' }, 400);
  }

  const secrets = readFirebaseAdminSecrets();
  if (!secrets) return response({ error: 'function_not_configured' }, 503);

  let services: ReturnType<typeof getFirebaseAdminServices>;
  try {
    services = getFirebaseAdminServices(secrets);
  } catch {
    console.error('Firebase Admin initialization failed. Check Functions environment configuration.');
    return response({ error: 'function_not_configured' }, 503);
  }

  let ownerUid: string;
  try {
    const decoded = await services.adminAuth.verifyIdToken(tokenMatch[1], true);
    ownerUid = decoded.uid;
  } catch {
    return response({ error: 'unauthorized' }, 401);
  }
  if (ownerUid !== secrets.ownerUid) return response({ error: 'owner_only' }, 403);

  try {
    const ownerMembership = await services.firestore.doc(`users/${ownerUid}/members/${ownerUid}`).get();
    if (!ownerMembership.exists
      || ownerMembership.data()?.role !== 'owner'
      || ownerMembership.data()?.active !== true) {
      return response({ error: 'owner_membership_missing' }, 403);
    }
  } catch {
    console.error('Owner membership verification failed.');
    return response({ error: 'service_unavailable' }, 503);
  }

  let createdUid: string;
  try {
    const createdUser = await services.adminAuth.createUser({
      email,
      password,
      displayName,
      emailVerified: false,
      disabled: false,
    });
    createdUid = createdUser.uid;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'auth/email-already-exists') return response({ error: 'email_already_in_use' }, 409);
    if (code === 'auth/invalid-email') return response({ error: 'invalid_email' }, 400);
    if (code === 'auth/invalid-password') return response({ error: 'invalid_password' }, 400);
    console.error('Firebase Auth account creation failed.');
    return response({ error: 'account_creation_failed' }, 500);
  }

  try {
    await services.firestore.doc(`users/${ownerUid}/members/${createdUid}`).create({
      uid: createdUid,
      email,
      displayName,
      role: 'staff',
      active: true,
      createdBy: ownerUid,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    await services.adminAuth.deleteUser(createdUid).catch(() => undefined);
    console.error('New staff membership creation failed; auth cleanup was attempted.');
    return response({ error: 'membership_creation_failed' }, 500);
  }

  return response({ uid: createdUid, email, displayName }, 201);
};

export const config: Config = {
  path: '/api/team/create',
  method: ['POST'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: 'ip',
    windowSize: 60,
    windowLimit: 5,
  },
};
