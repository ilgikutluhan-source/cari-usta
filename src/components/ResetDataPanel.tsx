import { useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import { resetLedger } from '../services/reset-ledger';

type ResetDataPanelProps = {
  user: User;
  onResetComplete: (result: Awaited<ReturnType<typeof resetLedger>>) => void;
};

export default function ResetDataPanel({ user, onResetComplete }: ResetDataPanelProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function openDialog() {
    setConfirmation('');
    setError('');
    setOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    setOpen(false);
    setConfirmation('');
    setError('');
  }

  async function submitReset() {
    if (confirmation.trim() !== 'SIFIRLA' || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await resetLedger(user);
      setOpen(false);
      setConfirmation('');
      onResetComplete(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cari verileri sıfırlanamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel reset-panel">
      <div className="reset-panel-heading">
        <span className="reset-panel-icon"><AlertTriangle size={19} /></span>
        <div>
          <span className="eyebrow">SAHİP YETKİSİ · GERİ ALINAMAZ</span>
          <h2>Ortak cari verilerini sıfırla</h2>
          <p>Bu işlem tüm cihazlardaki cari defterini temizler; çalışan girişlerini ve kullanıcı üyeliklerini korur.</p>
        </div>
      </div>
      <div className="reset-panel-footer">
        <span><ShieldCheck size={15} /> Yalnızca işletme sahibi çalıştırabilir.</span>
        <button type="button" className="button reset-open-button" onClick={openDialog}><RotateCcw size={15} /> Verileri sıfırla</button>
      </div>

      {open && (
        <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className="modal-card reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-dialog-title">
            <div className="modal-header">
              <div className="reset-modal-title">
                <span className="reset-modal-icon"><AlertTriangle size={19} /></span>
                <div><span className="eyebrow">KALICI SİLME UYARISI</span><h2 id="reset-dialog-title">Cari defteri sıfırlansın mı?</h2></div>
              </div>
              <button type="button" className="icon-button" onClick={closeDialog} disabled={busy} aria-label="Uyarıyı kapat"><X size={18} /></button>
            </div>
            <p className="reset-modal-intro">Bu işlem paylaşılan işletme alanındaki aşağıdaki kayıtları bütün cihazlardan kalıcı olarak silecek:</p>
            <ul className="reset-scope-list">
              <li>Aktif ve arşivlenmiş tüm müşteri cari kartları</li>
              <li>Borç, tahsilat, ürünlü satış ve vade hareketleri</li>
              <li>Ortak cari hareket/aktivite kayıtları</li>
            </ul>
            <div className="reset-preserve-note"><ShieldCheck size={16} /><span>Çalışanların Firebase giriş hesapları, ortak üyelikleri ve Firebase/Netlify ayarları silinmez. Demo örnekleri bu işlem kapsamına girmez.</span></div>
            <div className="reset-lock-note">Silme sürerken cari kayıt yazımı geçici olarak durdurulur. İşlem yarıda kalırsa, owner tekrar deneyerek temizliği tamamlayabilir ve yazımı yeniden açabilir.</div>
            <label className="field reset-confirm-field">
              <span>İkinci onay için <strong>SIFIRLA</strong> yazın</span>
              <input value={confirmation} onChange={(event) => setConfirmation(event.target.value.toLocaleUpperCase('tr-TR'))} placeholder="SIFIRLA" autoComplete="off" spellCheck={false} aria-label="Sıfırlama onay metni" />
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="modal-actions reset-modal-actions">
              <button type="button" className="button button-outline" onClick={closeDialog} disabled={busy}>Vazgeç</button>
              <button type="button" className="button reset-confirm-button" onClick={() => { void submitReset(); }} disabled={busy || confirmation.trim() !== 'SIFIRLA'}>
                {busy ? 'Cari verileri temizleniyor…' : <><Trash2 size={15} /> Cari verilerini sil</>}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
