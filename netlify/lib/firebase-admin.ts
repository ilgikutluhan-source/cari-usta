import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

declare const Netlify: { env: { get(name: string): string | undefined } };

const adminAppName = 'caliskanlar-admin';

export type FirebaseAdminSecrets = {
  projectId: string;
  ownerUid: string;
  clientEmail: string;
  privateKey: string;
};

export function readFirebaseAdminSecrets(): FirebaseAdminSecrets | null {
  const projectId = Netlify.env.get('FIREBASE_PROJECT_ID')?.trim();
  const ownerUid = Netlify.env.get('FIREBASE_OWNER_UID')?.trim();
  const clientEmail = Netlify.env.get('FIREBASE_ADMIN_CLIENT_EMAIL')?.trim();
  const rawPrivateKey = Netlify.env.get('FIREBASE_ADMIN_PRIVATE_KEY');
  if (!projectId || !ownerUid || !clientEmail || !rawPrivateKey) return null;
  return {
    projectId,
    ownerUid,
    clientEmail,
    privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
  };
}

export function getFirebaseAdminServices(secrets: FirebaseAdminSecrets) {
  const existing = getApps().find((app) => app.name === adminAppName);
  const app = existing ?? initializeApp({
    projectId: secrets.projectId,
    credential: cert({
      projectId: secrets.projectId,
      clientEmail: secrets.clientEmail,
      privateKey: secrets.privateKey,
    }),
  }, adminAppName);
  return { adminAuth: getAuth(app), firestore: getFirestore(app) };
}
