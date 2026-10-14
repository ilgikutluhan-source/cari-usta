import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';

export type WorkspaceRole = 'owner' | 'staff';

export type WorkspaceMember = {
  uid: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  active: boolean;
  createdAt?: unknown;
};

const requiredDb = () => {
  if (!db) throw new Error('Firebase Firestore bağlantısı bulunamadı.');
  return db;
};

function memberRef(ownerUid: string, memberUid: string) {
  return doc(requiredDb(), 'users', ownerUid, 'members', memberUid);
}

function membersRef(ownerUid: string) {
  return collection(requiredDb(), 'users', ownerUid, 'members');
}

export async function ensureWorkspaceMembership(user: User, ownerUid: string): Promise<WorkspaceRole> {
  if (!ownerUid) throw new Error('İşletme UID ayarı bulunamadı.');
  const reference = memberRef(ownerUid, user.uid);
  const snapshot = await getDoc(reference);

  if (user.uid === ownerUid) {
    if (!snapshot.exists()) {
      const email = user.email ?? '';
      await setDoc(reference, {
        uid: user.uid,
        email,
        displayName: user.displayName || email.split('@')[0] || 'İşletme yöneticisi',
        role: 'owner',
        active: true,
        createdBy: ownerUid,
        createdAt: serverTimestamp(),
      });
      return 'owner';
    }

    const existing = snapshot.data();
    if (existing.role !== 'owner' || existing.active !== true) {
      throw new Error('İşletme yöneticisi üyelik kaydı geçersiz.');
    }
    return 'owner';
  }

  if (!snapshot.exists()) {
    throw new Error('Bu hesap Çalışkanlar Yapı Market çalışma alanına eklenmemiş. İşletme yöneticinizden hesap oluşturmasını isteyin.');
  }

  const membership = snapshot.data();
  if (membership.active !== true || membership.role !== 'staff') {
    throw new Error('Bu hesabın işletme erişimi etkin değil.');
  }
  return 'staff';
}

export async function createStaffAccount(
  ownerUid: string,
  owner: User,
  displayName: string,
  email: string,
  password: string,
): Promise<void> {
  if (!auth?.currentUser || owner.uid !== ownerUid || auth.currentUser.uid !== ownerUid) {
    throw new Error('Çalışan hesabı oluşturma yetkisi yalnızca işletme sahibindedir.');
  }
  const normalizedName = displayName.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    throw new Error('Ad soyad 2–80 karakter arasında olmalıdır.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('İlk şifre en az 12, en fazla 128 karakter olmalıdır.');
  }

  const idToken = await owner.getIdToken();
  let result: { error?: string; uid?: string } | null = null;
  let response: Response;
  try {
    response = await fetch('/api/team/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({ displayName: normalizedName, email: normalizedEmail, password }),
    });
    result = await response.json() as { error?: string; uid?: string };
  } catch {
    throw new Error('Hesap oluşturma sunucusuna ulaşılamadı. Netlify Function dağıtımını ve site bağlantısını kontrol edin.');
  }

  if (!response.ok) {
    const messages: Record<string, string> = {
      unauthorized: 'Yönetici oturumu doğrulanamadı. Çıkış yapıp yeniden giriş yapın.',
      owner_only: 'Çalışan hesabını yalnızca işletme sahibi oluşturabilir.',
      owner_membership_missing: 'Yönetici üyeliği bulunamadı. Güncel Firestore güvenlik kurallarının yayımlandığını kontrol edin.',
      function_not_configured: 'Netlify hesap oluşturma servisi henüz yapılandırılmadı. Functions secret değerlerini ekleyip siteyi yeniden dağıtın.',
      service_unavailable: 'Firebase üyelik servisine ulaşılamadı. Tekrar deneyin veya ayarları kontrol edin.',
      email_already_in_use: 'Bu e-posta Firebase Authentication içinde zaten kayıtlı.',
      invalid_email: 'Geçerli bir e-posta adresi girin.',
      invalid_password: 'İlk şifre 12–128 karakter arasında olmalıdır.',
      invalid_display_name: 'Ad soyad 2–80 karakter arasında olmalıdır.',
      membership_creation_failed: 'Üyelik kaydı oluşturulamadı. Sunucu yeni Auth hesabını geri almaya çalıştı; tekrar denemeden önce Firebase kullanıcı listesini kontrol edin.',
      account_creation_failed: 'Firebase hesabı oluşturulamadı. Authentication ayarlarını kontrol edip tekrar deneyin.',
    };
    throw new Error(messages[result?.error ?? ''] ?? 'Hesap oluşturulamadı. Sunucu ve Firebase ayarlarını kontrol edin.');
  }
  if (!result?.uid) throw new Error('Hesap oluşturma yanıtında kullanıcı UID değeri bulunamadı.');
}

export function watchWorkspaceMembers(
  ownerUid: string,
  next: (members: WorkspaceMember[]) => void,
  fail: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(membersRef(ownerUid), (snapshot) => {
    const members = snapshot.docs
      .map((item) => item.data() as WorkspaceMember)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'tr-TR'));
    next(members);
  }, fail);
}
