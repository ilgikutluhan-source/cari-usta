import type { User } from 'firebase/auth';

export type ResetLedgerResult = {
  deletedCustomers: number;
  deletedTransactions: number;
  deletedActivity: number;
};

const errorMessages: Record<string, string> = {
  unauthorized: 'Oturum doğrulanamadı. Çıkış yapıp yeniden giriş yapın.',
  owner_only: 'Cari verilerini sıfırlama yetkisi yalnızca işletme sahibindedir.',
  owner_membership_missing: 'İşletme sahibi üyeliği doğrulanamadı. Firebase üyelik ayarlarını kontrol edin.',
  invalid_confirmation: 'İkinci onay metni eşleşmedi; sıfırlama yapılmadı.',
  reset_in_progress: 'Başka bir cari sıfırlama işlemi çalışıyor. Biraz bekleyip tekrar deneyin.',
  function_not_configured: 'Sıfırlama servisi henüz yapılandırılmadı. Netlify Function ayarlarını kontrol edin.',
  reset_incomplete: 'Sıfırlama tamamlanamadı. Güvenlik için cari yazımları durduruldu; owner aynı işlemi yeniden deneyerek temizliği tamamlayıp yazımları açabilir.',
  service_unavailable: 'Sıfırlama sunucusuna ulaşılamadı. Cari kayıtlar kısmen temizlenmiş olabilir; owner durumunu kontrol edip yeniden deneyebilir.',
};

export async function resetLedger(user: User): Promise<ResetLedgerResult> {
  const idToken = await user.getIdToken();
  let response: Response;
  let result: Partial<ResetLedgerResult> & { error?: string } | null = null;
  try {
    response = await fetch('/api/ledger/reset', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({ confirmation: 'SIFIRLA' }),
    });
    result = await response.json() as Partial<ResetLedgerResult> & { error?: string };
  } catch {
    throw new Error('Sıfırlama servisine ulaşılamadı. Bağlantıyı kontrol edip daha sonra yeniden deneyin.');
  }

  if (!response.ok) {
    throw new Error(errorMessages[result?.error ?? ''] ?? 'Cari verileri sıfırlanamadı; Netlify Function durumunu kontrol edin.');
  }

  if (![result?.deletedCustomers, result?.deletedTransactions, result?.deletedActivity]
    .every((value) => Number.isSafeInteger(value) && (value ?? -1) >= 0)) {
    throw new Error('Sıfırlama yanıtı doğrulanamadı. Canlı kayıt durumunu owner hesabıyla kontrol edin.');
  }

  return {
    deletedCustomers: result.deletedCustomers as number,
    deletedTransactions: result.deletedTransactions as number,
    deletedActivity: result.deletedActivity as number,
  };
}
