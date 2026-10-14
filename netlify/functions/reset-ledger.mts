import type { Config, Context } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdminServices, readFirebaseAdminSecrets } from '../lib/firebase-admin.js';

const maxBodyBytes = 2048;
const batchSize = 400;
const customerPageSize = 40;
const transactionDeleteConcurrency = 8;
const staleLockAfterMs = 2 * 60_000;

type AdminFirestore = ReturnType<typeof getFirebaseAdminServices>['firestore'];
type AdminCollection = ReturnType<AdminFirestore['collection']>;

class ResetApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'ResetApiError';
  }
}

function response(body: Record<string, unknown>, status: number): Response {
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

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function deleteCollectionPages(database: AdminFirestore, reference: AdminCollection): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await reference.limit(batchSize).get();
    if (snapshot.empty) return deleted;
    const batch = database.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
}

async function deleteCustomerRecords(database: AdminFirestore, ownerUid: string): Promise<{ deletedCustomers: number; deletedTransactions: number }> {
  const customers = database.collection('users').doc(ownerUid).collection('customers');
  let deletedCustomers = 0;
  let deletedTransactions = 0;

  while (true) {
    const snapshot = await customers.limit(customerPageSize).get();
    if (snapshot.empty) break;

    for (let offset = 0; offset < snapshot.docs.length; offset += transactionDeleteConcurrency) {
      const page = snapshot.docs.slice(offset, offset + transactionDeleteConcurrency);
      const counts = await Promise.all(page.map((customer) => (
        deleteCollectionPages(database, customer.ref.collection('transactions'))
      )));
      deletedTransactions += counts.reduce((sum, count) => sum + count, 0);
    }

    const batch = database.batch();
    snapshot.docs.forEach((customer) => batch.delete(customer.ref));
    await batch.commit();
    deletedCustomers += snapshot.size;
  }

  return { deletedCustomers, deletedTransactions };
}

export async function acquireResetLock(database: AdminFirestore, lockRef: ReturnType<AdminFirestore['doc']>, ownerUid: string, operationId: string): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(lockRef);
    if (current.exists && current.data()?.status === 'running') {
      const data = current.data() ?? {};
      const leaseExpiresAt = data.leaseExpiresAt;
      const leaseExpiresAtMs = typeof leaseExpiresAt?.toMillis === 'function'
        ? leaseExpiresAt.toMillis()
        : (typeof data.startedAt?.toDate === 'function'
          ? data.startedAt.toDate().getTime() + staleLockAfterMs
          : 0);
      if (leaseExpiresAtMs > Date.now()) {
        throw new ResetApiError('reset_in_progress', 409);
      }
    }
    transaction.set(lockRef, {
      status: 'running',
      operationId,
      startedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + staleLockAfterMs),
      startedBy: ownerUid,
    });
  });
}

export async function releaseResetLock(database: AdminFirestore, lockRef: ReturnType<AdminFirestore['doc']>, operationId: string): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(lockRef);
    if (!current.exists || current.data()?.operationId !== operationId) {
      throw new ResetApiError('reset_lock_lost', 409);
    }
    transaction.delete(lockRef);
  });
}

export async function markResetIncomplete(database: AdminFirestore, lockRef: ReturnType<AdminFirestore['doc']>, operationId: string): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(lockRef);
    if (!current.exists || current.data()?.operationId !== operationId) return;
    transaction.set(lockRef, { status: 'incomplete', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  if (!isSameOrigin(request)) return response({ error: 'origin_not_allowed' }, 403);

  const tokenMatch = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!tokenMatch) return response({ error: 'unauthorized' }, 401);
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return response({ error: 'json_required' }, 415);
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return response({ error: 'invalid_request' }, 400);
  }
  if (new TextEncoder().encode(bodyText).byteLength > maxBodyBytes) {
    return response({ error: 'request_too_large' }, 413);
  }

  let input: unknown;
  try {
    input = JSON.parse(bodyText);
  } catch {
    return response({ error: 'invalid_json' }, 400);
  }
  if (!input || typeof input !== 'object'
    || (input as Record<string, unknown>).confirmation !== 'SIFIRLA') {
    return response({ error: 'invalid_confirmation' }, 400);
  }

  const secrets = readFirebaseAdminSecrets();
  if (!secrets) return response({ error: 'function_not_configured' }, 503);

  let services: ReturnType<typeof getFirebaseAdminServices>;
  try {
    services = getFirebaseAdminServices(secrets);
  } catch {
    console.error('Firebase Admin initialization failed for ledger reset endpoint.');
    return response({ error: 'function_not_configured' }, 503);
  }

  let userUid: string;
  try {
    const decoded = await services.adminAuth.verifyIdToken(tokenMatch[1], true);
    userUid = decoded.uid;
  } catch {
    return response({ error: 'unauthorized' }, 401);
  }
  if (userUid !== secrets.ownerUid) return response({ error: 'owner_only' }, 403);

  try {
    const ownerMembership = await services.firestore.doc(`users/${secrets.ownerUid}/members/${secrets.ownerUid}`).get();
    const membership = ownerMembership.data();
    if (!ownerMembership.exists || membership?.uid !== userUid
      || membership.role !== 'owner' || membership.active !== true) {
      return response({ error: 'owner_membership_missing' }, 403);
    }
  } catch {
    console.error('Owner membership verification failed for ledger reset endpoint.');
    return response({ error: 'service_unavailable' }, 503);
  }

  const lockRef = services.firestore.doc(`users/${secrets.ownerUid}/system/ledgerReset`);
  const operationId = randomUUID();
  try {
    await acquireResetLock(services.firestore, lockRef, userUid, operationId);
  } catch (error) {
    if (error instanceof ResetApiError) return response({ error: error.code }, error.status);
    console.error('Ledger reset lock acquisition failed.');
    return response({ error: 'service_unavailable' }, 503);
  }

  try {
    const activityRef = services.firestore.collection('users').doc(secrets.ownerUid).collection('activity');
    const [customerResult, deletedActivity] = await Promise.all([
      deleteCustomerRecords(services.firestore, secrets.ownerUid),
      deleteCollectionPages(services.firestore, activityRef),
    ]);
    await releaseResetLock(services.firestore, lockRef, operationId);
    return response({ ...customerResult, deletedActivity }, 200);
  } catch {
    await markResetIncomplete(services.firestore, lockRef, operationId).catch(() => undefined);
    console.error('Ledger reset did not complete; the reset lock remains for an owner retry.');
    return response({ error: 'reset_incomplete' }, 503);
  }
};

export const config: Config = {
  path: '/api/ledger/reset',
  method: ['POST'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: 'ip',
    windowSize: 60,
    windowLimit: 3,
  },
};
