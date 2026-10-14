# Çalışkanlar Yapı Market — Görevler

**Kod durumu:** Cari, borç/tahsilat ve vade akışları; Türkçe kuruş hassasiyetli TL girişi; owner-token ile çalışan hesabı oluşturma; ortak üyelik güvenliği; gerçek zamanlı cari listesi ve arşiv; çalışan borç akışına entegre edilen tek **Satış** formu (isteğe bağlı 1–25 ürün satırı, hesaplanan TRY toplamı, ürünlü ekstre/fiş); owner-only iki aşamalı ortak defter sıfırlama; kullanıcı tarafından gönderilen WhatsApp taslağı; her sekmeden erişilen tek **Cari Ekle** düğmesi; müşteri adı/telefonu için Rules allowlist'i olan düzenleme formu uygulandı. Ayrı ürünlü satış formu ve `create-sale` Function kaldırıldı; eski cari hareketleri korunuyor. Ürün değerleri `src/sales-validation.ts` içinde kuruş/miktar bazında doğrulanıp integer-only saklanıyor. Build, TypeScript, servis validation unit testleri ve Rules emulator senaryoları geçti. Güncel Firestore Rules `cari-usta-web` projesinde yayımlandı; üretim build'i 2026-10-10'da yalnızca `cari-usta` Netlify sitesine deploy edildi ve canlı `https://cari-usta.netlify.app/` ile login uygulama başlığı HTTP 200 döndü. Canlı JS bundle tek **Satış** formunu içeriyor, eski ürünlü satış API çağrısını içermiyor. Yeni Satış doğrudan Firestore hareketini kullanır; çalışan hesabı oluşturma ve owner-only sıfırlama Function'ları için Admin credential ayarı hâlâ ayrı açık maddedir.

## 1. Cari hesap, borç/tahsilat ve vade akışı
- Müşteri cari hesapları listelenip oluşturulabilmeli; her müşteri için toplam borç, toplam tahsilat ve kalan bakiye görüntülenebilmeli.
- Uygulamanın her sekmesinde görünür tek bir **Cari Ekle** düğmesi bulunmalı; düğme yeni cari formunu açmalı ve yinelenen ekleme düğmeleri olmamalı.
- Oluşturulmuş cari hesabın müşteri adı ve telefon numarası yetkili kullanıcı tarafından müşteri detayından düzenlenebilmeli; ad zorunlu, telefon isteğe bağlı olmalı; yeni değer tüm açık cihazlara gerçek zamanlı yansımalı.
- Profil düzenlemesi yalnızca ad, telefon ve güncelleme zamanını değiştirebilmeli; borç, tahsilat, bakiye, vade, arşiv durumu ve hareket geçmişi değişmeden korunmalı; eski hareketlerdeki isim kopyası tarihsel kalmalı.
- Müşteri hesaplarında arama/filtreleme yapılabilmeli; yeni borç ve tahsilat tutarı/tarihi kaydedilebilmeli; müşteri hareket geçmişi kronolojik görülebilmeli.
- Borç ve tahsilat tutarı Türkçe TL biçiminde (ör. `1.250,50`) girilebilmeli; tutar iki kuruş hanesiyle sınırlanmalı, aynı TRY biçiminde gösterilmeli ve tahsilat sonrası kalan bakiye girilen tutarla anlık hesaplanmalı. Örn. `12345` rakamları sırayla yazıldığında `12.345` olarak kalmalı; binlik noktasından sonra girilen 4. ve devamı basamaklar kuruş sanılmamalı.
- Müşteri telefon numarası yazılırken Türkiye biçiminde boşluklar otomatik yerleşmeli; para alanlarında binlik noktası otomatik eklenmeli ve kullanıcı boşluk/binlik noktası girmek zorunda kalmamalı. Kuruş girişi virgülle yapılmalı ve en fazla iki hane kabul edilmeli.
- Müşteri ödeme vadesi görüntülenip güncellenebilmeli; yaklaşan ve gecikmiş vadeler belirgin biçimde gösterilmeli.
- Tahsilat güncel kalan bakiyeyi aşamamalı; cari özeti, hareket ve aktivite kaydı tek atomik Firestore işlemiyle tutarlı kalmalı.
- Her borç/tahsilat hareketi tam sayı kuruş (`amountCents`) ile eşleşmeli; alt-kuruş veya çelişen tutar reddedilmeli. Cari toplamları kuruş hassasiyetinde normalleştirilmeli ve bakiye sıfır olduğunda vade temizlenmeli.

## 2. Satış akışı: mevcut borç formu ve ürün satırları
- Müşteri detayında ayrı **Ürünlü satış** ve **Borç ekle** düğmeleri yerine tek **Satış** düğmesi bulunmalı; bu düğme daha önce çalışan doğrudan Firestore borç hareketi akışını açmalı. **Tahsilat al** ayrı kalmalı.
- Satış formu ürün eklenmeden kullanıldığında mevcut elle tutar, işlem tarihi, ödeme vadesi ve açıklama girişini korumalı; tutar müşteri cari borcuna borç hareketi olarak eklenmeli.
- Satış formuna en fazla 25 ürün satırı eklenebilmeli. Her satır ürün adı, miktar (en fazla 3 ondalık), birim ve birim fiyatı içermeli; satır toplamı ve genel satış toplamı miktar/fiyattan otomatik hesaplanmalı ve TRY tutarları iki kuruş hanesinde tutulmalı. Yeni kayıtlar görüntüleme alanlarının yanında tamsayı `quantityMilli`, `unitPriceCents` ve `lineTotalCents` değerlerini saklamalı.
- Ürün satırı varsa genel toplam elle tutar alanının yerine geçmeli ve cari borca eklenmeli. Bu akışta peşin/kısmi ödeme veya ödeme yöntemi alınmamalı; alınan para ayrı **Tahsilat al** hareketi olarak kaydedilmeli.
- Ürün kalemleri ile `amountCents`, borç hareketi, cari toplamı ve aktivite kaydı aynı Firestore transaction'ında yazılmalı; `src/sales-validation.ts` ürün adı/birimini, miktar ve fiyat hassasiyetini, miktar × birim fiyatın kuruşa yuvarlanan satır toplamını ve tüm satırların genel toplamının `amountCents` ile eşleşmesini doğrulamalı. Firestore Rules ürün listesini yalnızca borç hareketinde ve en fazla 25 satırda kabul etmeli, cari bakiye geçişini ve transaction/activity kopyalarının eşitliğini korumalı. Yeni satış Admin SDK `create-sale` Function'ına bağlı olmamalı.
- Müşteri kartında ürünlü satışların ürün adı, miktarı, birimi, birim fiyatı, satır toplamı, satış tarihi ve toplamıyla görüntülenmesi; ürünlü satır ve fiyatları içeren ekstre veya seçili satış fişinin yazdırılabilmesi/PDF olarak kaydedilebilmesi sürmeli. Çıktı tasarımı profesyonel, siyah-kırmızı-beyaz marka düzeninde olmalı; cari ekstresi A4, satış fişi sabit 80×80 mm kare yazdırma görünümünü desteklemeli.
- Ürün fiyatları %20 KDV dâhil kabul edilmeli; kaydedilen brüt satış/cari borç tutarı değişmemeli. Her yeni Satış hareketinde `vatRateBps=2000`, `vatBaseCents` ve `vatCents` atomik hareket kayıtlarına yazılmalı; matrah `round(brüt kuruş × 5/6)`, KDV brüt eksi matrah olmalı ve matrah+KDV brüte tam eşit olmalı. Ürün satırları ve fiş/ekstre %20 oranı, matrah, KDV tutarı ve KDV dâhil toplamı göstermeli. Vergi alanı olmayan geçmiş ürünlü satışlarda %20 mevcut brüt tutardan ayrıştırılmalı; ürün bilgisi olmayan eski borçlar KDV satış özeti sayılmamalı.
- Ekstre kronolojik hareketleri, açılış/devir bakiyesini, her hareket sonrası cari bakiyeyi ve güncel bakiyeyi göstermeli. Eski ürün ayrıntısı olmayan borçlar veya geçmiş ürünlü satışlar silinmemeli ya da hesap bakiyeleri değiştirilmemeli.
- Çıktı iç kullanım amaçlı cari fişi/ekstresi olmalı; resmî e-Fatura/e-Arşiv belgesi veya stok miktarı değişikliği iddiasında bulunmamalı.

## 3. Farklı kullanıcılar için yönetici kontrollü hesaplar
- Farklı bilgisayarlardaki kullanıcılar ayrı e-posta ve şifreleriyle giriş yapabilmeli.
- İşletme yöneticisi Kullanıcılar alanından çalışan hesabı oluşturabilmeli; çalışan e-postası ve ilk şifresi yönetici tarafından girilmeli; yönetici hesabı oluştururken oturumunu kaybetmemeli.
- Çalışan hesabı yalnızca Firebase ID token'ı doğrulanmış işletme yöneticisinin Netlify Function isteğiyle oluşturulmalı; parola Firestore'a, kaynak koda veya loglara kaydedilmemeli.
- Giriş ekranında herkese açık hesap oluşturma bulunmamalı. Yalnızca owner üyelik kaydı olan hesaplar ortak işletme verilerine erişebilmeli.

## 4. Ortak ve eşzamanlı cari defteri
- Yetkilendirilmiş kullanıcılar aynı mevcut işletme cari defterini görebilmeli; mevcut kayıtlar yeni kullanıcı alanına taşınmamalı veya silinmemeli.
- Bir bilgisayarda oluşturulan cari, ürünlü satış, borç, tahsilat veya vade değişikliği diğer açık oturumlarda gerçek zamanlı görünmeli.
- Firestore kuralları her cari/hareket isteğinde kullanıcının o işletmenin üyeliğini doğrulamalı; başka UID alanı veya üyelik belgeleri üye olmayanlarca okunup yazılamamalı.

## 5. Senkron arşivleme ve geri alma
- Yetkili kullanıcı müşteriyi arşivlediğinde cari tüm kullanıcıların aktif listesinden kaldırılmalı ve diğer bilgisayarda da güncellenmeli.
- Müşteri hareket geçmişi fiziksel olarak silinmemeli; arşiv görünümünden hareketleri açılabilmeli ve cari geri yüklenebilmelidir.
- Firestore kuralları arşiv işlemini yalnızca arşiv alanı ve güncelleme zamanını değiştiren geçerli müşteri güncellemesi olarak kabul etmeli; borç, tahsilat, bakiye, vade veya işlem alanlarıyla birleştirilmiş sahte değişiklikleri reddetmeli.

## 6. Çalışanların cari verisi sıfırlaması — tamamlandı
- Veri sıfırlama aracı **Kullanıcılar** alanında yalnızca işletme sahibi tarafından görülebilmeli ve kullanılabilmeli; Netlify Function geçerli Firebase ID token'ını ve işletme owner UID/aktif owner üyeliğini sunucu tarafında doğrulamalı.
- Butona basıldığında silinecek veriler açıkça uyarılmalı; devam etmek için kullanıcı `SIFIRLA` yazarak ikinci onay vermeli. Onay olmadan hiçbir kayıt silinmemeli.
- Onaylı sıfırlama, mevcut `users/{ownerUid}` alanındaki bütün aktif ve arşivli müşteri başlıklarını, müşteri `transactions` kayıtlarını (borç, tahsilat, satış ve vade değişikliği hareketleri) ve ortak `activity` kayıtlarını silmeli; çalışan Auth hesaplarını, üyelik kayıtlarını ve Firebase/Netlify ayarlarını korumalı.
- Sıfırlama bağlı ortak işletme alanında yürütülmeli; başarıyla tamamlandığında diğer açık oturumlar boş cari ve hareket listesini gerçek zamanlı görmeli.
- Sıfırlama sürerken Firestore Rules ortak kilitle istemci üzerinden cari, satış ve tahsilat yazımlarını geçici olarak engellemeli; başarısız/yarım kalan işlemde kilit korumalı kalmalı ve owner yeniden deneyerek kalan kayıtları temizleyip sistemi açabilmeli. Kullanıcı üyelikleri ve giriş erişimi silinmemeli.
- Demo/örnek tarayıcı kayıtları bu canlı işletme sıfırlama işleminin hedefi olmamalı.

## 7. WhatsApp hatırlatması ve A4 ekstre PDF paylaşımı
- Pozitif bakiyeli ve WhatsApp için geçerli telefon numarası olan müşteri detayında bir **WhatsApp için ekstre PDF hazırla** eylemi bulunmalı; A4 ekstrede kronolojik cari hareketleri, açılış/devir tutarı, hareket sonrası ve güncel bakiye ile varsa KDV özeti kullanılmalı.
- PDF cari ekstre markup'ından tarayıcıda oluşturulmalı ve müşteri verisi PDF üretmek için sunucuya yüklenmemeli.
- Dosya paylaşımını destekleyen telefonlarda kullanıcı sistem paylaşım menüsünü açabilmeli ve WhatsApp'ı kendisi seçebilmeli; paylaşım metni mevcut hatırlatma taslağını içermeli.
- Dosya paylaşımını desteklemeyen cihazlarda PDF indirilebilmeli ve WhatsApp konuşması hatırlatma taslağıyla açılabilmeli; kullanıcı PDF'i sohbete kendisi ekleyip mesajı kontrol ederek göndermeli. Hiçbir cihazda uygulama mesajı veya dosyayı otomatik göndermemeli.

## 7. Borçlulara WhatsApp hatırlatması — tamamlandı
- Pozitif bakiyesi olan müşterinin detay kartında, geçerli telefon numarası varsa WhatsApp hatırlatma bağlantısı bulunmalı; telefon eksik/geçersizse kullanıcı numaranın eklenmesi gerektiğini görmeli.
- Bağlantı WhatsApp sohbetini Türkçe, önceden doldurulmuş ve düzenlenebilir bir mesajla açmalı; mesaj müşteri adını, güncel bakiyeyi ve tanımlıysa ödeme vadesini içermeli.
- Mesaj otomatik gönderilmemeli; kullanıcı WhatsApp'ta mesajı gözden geçirip düzenleyebilmeli ve Gönder'e kendisi basmalı. Uygulama WhatsApp mesajı göndermek için API/secret kullanmamalı.
- Türkiye telefon numaraları `0 5xx...`, `5xx...`, `+90...` biçimlerinden WhatsApp `wa.me` bağlantısı için normalize edilmeli; geçersiz veya boş numaraya sohbet başlatılmamalı.

## 8. Çalışkanlar markası ve kurulum açıklamaları
- Arayüz siyah, kırmızı ve beyaz tema ile **Çalışkanlar Yapı Market** adıyla görünmeli.
- `.env.example` içinde Firebase web ayarlarıyla birlikte işletmenin mevcut Firebase Auth UID'si olan `VITE_CARI_OWNER_UID` belgelendirilmeli.
- README; aynı mevcut veri yolunun nasıl korunduğunu, **Satış** formunun stok katalog seçimini ve borca eklenmesini, **Peşin Satış** sekmesinin bağımsız belge/stock decrement davranışını, tahsilatın ayrı kaydedildiğini ve müşteriye çıktı almayı, yöneticinin kullanıcı oluşturmasını, owner-only iki aşamalı veri sıfırlamayı, WhatsApp taslak mesajının kullanıcı tarafından gönderilmesini, Admin SDK credential'larının çalışan hesabı/sıfırlama/stoklu satış/peşin satış Function'ları için yalnızca Netlify'da nasıl güvenli ekleneceğini, Firestore kurallarının nasıl yayımlanacağını ve Netlify build UID ayarını açıklamalı.

## 9. Canlı kullanım için dış kurulum — açık
- Netlify build scope'a `VITE_CARI_OWNER_UID`; çalışan hesabı oluşturma, owner-only sıfırlama, stoklu cari satış ve Peşin Satış Function'ları için Functions runtime scope'a `FIREBASE_PROJECT_ID`, aynı UID'yi içeren `FIREBASE_OWNER_UID`, `FIREBASE_ADMIN_CLIENT_EMAIL` ve `FIREBASE_ADMIN_PRIVATE_KEY` eklenmeli. Ürünlü satışlar bu Admin Function'larına güvenli biçimde yönlendirilmeli; private key yalnızca kullanıcının Netlify arayüzünde girilmeli ve sohbete gönderilmemeli.
- Güncel `firestore.rules` dosyası `cari-usta-web` Firebase projesinde yayımlandı (2026-10-10).
- Yeni kod yalnızca ayrı `cari-usta` Netlify sitesine dağıtıldı; mevcut `caliskanyapimarket.netlify.app` sitesi bu işlemde hedeflenmedi.

## 10. Açık/koyu tema seçeneği — tamamlandı
- Uygulama açık ve koyu görünüm arasında geçiş yapabilen, üst çubuktan erişilebilir bir tema düğmesi sunmalı; düğmenin erişilebilir adı mevcut görünüm ve geçiş hedefini anlaşılır biçimde belirtmeli.
- Kullanıcının seçimi aynı tarayıcıda sonraki ziyaretlerde korunmalı; önceden seçilmiş tercih yoksa ilk görünüm cihazın açık/koyu renk tercihiyle eşleşmeli.
- Koyu görünüm ana çalışma alanını, tabloları, kartları, formları, satış/tahsilat pencerelerini, giriş ve kurulum ekranlarını okunaklı biçimde kapsamalı; Çalışkanlar kırmızısı ile borç/tahsilat/vade durumlarının anlamlı renk ayrımı korunmalı.
- Tema tercihi cari, kullanıcı, tahsilat, satış veya Firestore verisini değiştirmemeli; A4 ekstre ve 80×80 mm fiş açık, yazdırmaya uygun çıktısını korumalı.
- Durum/evidence: `pnpm test:money`, `pnpm build` ve `git diff --check` başarılı; canlı önizlemede koyu/açık geçiş, saklanan tercihin sayfa yenileme sonrası korunması ve koyu çalışma alanı/kart kontrastı doğrulandı.

## 11. Son tahsilat ve vade hatırlatmaları bildirimi — tamamlandı
- Üst çubuktaki zil düğmesi tıklanınca erişilebilir bir panel açılıp kapanmalı; panel son tahsilat kayıtlarını ve vade hatırlatmalarını listelemeli. Sayaç panelde gösterilen kayıt sayısını belirtmeli; okunmamış/teslim edilmiş push bildirimi iddiasında bulunmamalı.
- Son tahsilatlar ortak hareket akışındaki en yeni 50 kayıttan tarihe göre seçilen en yeni beş tahsilatı göstermeli; müşteri adı, işlem tarihi, tutarı ve varsa açıklaması görünmeli. Tahsilat satırına tıklamak ilgili cari detayını açmalı.
- Vade hatırlatmaları açık bakiyesi olan carilerden mevcut `dueState` kuralıyla vadesi geçmiş olanları ve önümüzdeki 7 gün içindekileri göstermeli; cari adı, vade durumu/tarihi ve açık bakiye görünmeli. Satıra tıklamak cari detayını açmalı.
- Bildirimler yalnızca mevcut müşteri ve aktivite verisinden türetilmeli; yeni tahsilat, vade veya bildirim belgesi yazmamalı. Mevcut **Vade Takvimi** ekranının hesaplama, filtre, liste ve görünümü bozulmadan korunmalı.
- Panel klavyeyle kapatılabilmeli (Escape), panel dışına tıklanınca kapanmalı ve açık/koyu tema kontrastı korunmalı.
- Durum/evidence: `pnpm test:money`, `pnpm build` ve `git diff --check` başarılı; demo önizlemede panelde 3 vade ve 3 son tahsilat, ilgili cari detayına geçiş, Escape/dış tıklamayla kapanış ve koyu tema renkleri doğrulandı. Vade Takvimi aynı 4 cari kaydı ve filtreleriyle çalışmaya devam etti; demo verisinde hiçbir kayıt yazılmadı.


## 12. Ortak ürün stok kataloğu ve stok alanı — tamamlandı
- Uygulamada yeni bir **Stok** alanı bulunmalı; katalog yetkili kullanıcılar arasında ortak olmalı ve ürün ekleme/düzenleme/stok değişikliği diğer açık cihazlara gerçek zamanlı yansımalı.
- Ürün oluşturma/düzenleme ürün adını, isteğe bağlı stok kodunu, birimini, KDV dâhil satış fiyatını, başlangıç/mevcut miktarını ve düşük stok eşiğini yönetebilmeli; ürün arşivleme mevcut satış geçmişini bozmadan yapılmalı.
- Kullanıcı stok girişi ve sayım düzeltmesi yapabilmeli; miktar en fazla 3 ondalık hane ile kuruş hassasiyetindeki TL fiyatları tamsayı alanlarda saklanmalı. Her açılış/giriş/düzeltme kaydı önceki-sonraki miktar ve tarih/notuyla stok hareket geçmişine eklenmeli; stok sıfırın altına düşmemeli.
- Stok listesi mevcut/açık miktarı, birimi, KDV dâhil satış fiyatını ve normal/düşük/tükendi durumunu anlaşılır göstermeli; düşük stok varsayılan eşik üzerinden hesaplanmalı, kullanıcı eşiği değiştirebilmeli. Demo görünümündeki işlemler yalnızca demo tarayıcı verisini değiştirmeli.
- Owner-only cari verisi sıfırlama işlemi müşteri/cari defteri kapsamını korumalı; bu stok özelliği ürün kataloğunu ve stok miktarlarını sıfırlamamalı veya silmemeli.
- Kanıt: `pnpm test:inventory`, TypeScript/Functions/Vite üretim derlemesi ve demo Preview'daki Stok ekranı başarılı; sıfırlama Function'ı yalnızca customers, transactions ve activity koleksiyonlarını temizliyor, inventory/stockActivity kayıtlarına dokunmuyor.

## 13. Satışta katalogdan ürün seçimi ve atomik stok düşümü — tamamlandı
- Mevcut **Satış** penceresindeki her ürün satırı stok kataloğundan ürün seçebilmeli; seçim ürün adını, birimini, KDV dâhil kayıtlı satış fiyatını ve mevcut stoğu göstermeli. Mevcut serbest ürün satırı seçeneği stok dışı olarak korunmalı.
- Satış miktarı en fazla 3 ondalık hane ile girilmeli; aynı satışta aynı ürün birden fazla satırda seçilmişse toplam miktar birlikte denetlenmeli. Mevcut stoktan fazla satış kaydedilmemeli; stok değişikliği başka cihazda önce gerçekleşmişse kaydın tamamı reddedilmeli ve müşteri/cari/aktivite kısmi yazılmamalı.
- Katalog seçili ürünün stok miktarı, müşteri cari toplamı, satış hareketi, aktivite kopyası ve stok hareket geçmişi aynı Firestore transaction'ında atomik güncellenmeli. Satış satırı ürün kimliğini ve satış anındaki ad/birim/miktar/fiyat/toplam kopyasını saklamalı; geçmiş satış katalogdaki sonraki düzenlemeden etkilenmemeli.
- KDV dâhil fiyat, %20 KDV matrahı/KDV ayrıştırması, tahsilatın ayrı **Tahsilat al** hareketi olması, cari vade ve A4/80×80 mm satış çıktıları mevcut davranışını korumalı. Serbest ürün satırları stok miktarını değiştirmemeli.
- Kanıt: Preview'da katalog seçimi ad/birim/fiyatı ve satış toplamını otomatik doldurdu; Firebase Admin Function Emulator testi aynı transaction'da cari, ürün, transaction/activity ve stok hareketini doğruladı. Aynı ürünü iki satırda seçme, stok yetersizliği, reset kilidi ve yinelenen istek reddi geçti; Rules Emulator doğrudan istemci satış yazımını reddetti. Canlı siteye test hareketi yazılmadı.

## 14. Stok veri erişimi ve tutarlılık kuralları — tamamlandı
- `inventory` ve `stockActivity` yalnızca mevcut işletmenin aktif owner/staff üyeleri tarafından okunup yazılmalı; başka UID alanları ve üye olmayan hesaplar erişememeli. Ürünlü satış yalnızca doğrulanmış Firebase ID token'ı ve aktif owner/staff üyeliği bulunan sunucu Function'ı üzerinden yazılmalı.
- Ürün/stok güncellemesi ile eşleşen stok hareketi atomik bağlı olmalı; reset kilidi sürerken istemci stok yazımı ve sunucu ürünlü satışı durmalı. İstemci `items`/`stockDeltas` içeren satış hareketini veya `sale` stok hareketini doğrudan yazamamalı. Mevcut customer, activity, transaction ve members kayıtlarının güvenlik kuralları gevşetilmemeli.
- Firestore Rules veya indeksleri güncellemek gerekiyorsa ilgili uygulama verisi/sunum güncellemesi tamamlanmalı; canlı stok verisini test amacıyla değiştirmemeli veya silmemeli.
- Kanıt: Rules Emulator owner/staff okumalarını kabul etti, pasif/üye olmayan erişimini, doğrudan stok değişimini, cari defter yazımını ve itemized-sale yazımını reddetti; reset kilidi ürün düzenlemesi ve stok girişini durdurdu. Admin Function Emulator testi aktif üyeliği, reset kilidini, yetersiz stokta atomik geri almayı ve satış yazımlarını doğruladı; reset lock fencing testi eski isteğin yeni kilidi bırakamadığını doğruladı. Yayımlama öncesi tüm test verisi Emulator'da kaldı.


## 15. Cari satışta stok ürününü hızlıca seçme — tamamlandı
- Cari detayındaki **Satış** formunda stok kataloğu ilk bakışta kolayca seçilebilmeli; kullanıcı önce ek bir boş satır oluşturmak zorunda kalmamalı. Ürün seçimi ad, birim ve KDV dâhil katalog fiyatını doldurmalı; miktar düzenlenebilmeli; serbest ürün/tutar girişi stoktan düşmeden çalışmaya devam etmeli.
- Stok ürünüyle cari satış kaydı, müşteri bakiyesi, transaction/activity kopyaları, ürün miktarı ve stockActivity hareketini tek yetkili server transaction'ında atomik yazmalı. Fiyatı değişen ürün, pasif ürün, reset kilidi veya yetersiz stok nedeniyle herhangi bir adım reddedilirse hiçbir cari/stok belgesi kısmi yazılmamalı.
- Kanıt: Preview'da doğrudan stok seçimi ürün adı/birim/fiyatını doldurdu; test için hiçbir satış kaydedilmedi. Emulator'da cari+stok transaction'ı, fiyat/stock/reset/duplicate/üyelik sınırları ve atomik geri alma doğrulandı. Pasif katalog ürünleri cari Satış dropdown'larından filtrelenir; manuel satış girişi korunur.

## 16. Bağımsız Peşin Satış sekmesi ve yazdırılabilir satış belgesi — tamamlandı
- Yan menüde **Peşin Satış** sekmesi bulunmalı; aktif stok kataloğundan bir veya daha çok ürün ve miktar seçilebilmeli; ürün adı/birimi/KDV dâhil fiyatı katalogdan alınmalı; satış tarihi, ödeme yöntemi, isteğe bağlı müşteri ve açıklama girilebilmeli; %20 KDV matrahı, KDV ve genel toplam kuruş hassasiyetinde gösterilmeli.
- Peşin satış ayrı satış belgesi olarak farklı cihazlarda gerçek zamanlı görünmeli ve benzersiz numara taşımalı; seçilen müşteri varsa belgeye isim kopyalanmalı ancak cari bakiyesi, borç/tahsilat toplamı, customer transaction veya cari activity değiştirilmemeli. Satış belgesi, stok düşümü ve her ürünün stockActivity kaydı aynı yetkili server transaction'ında atomik yazılmalı; aktif üye, güncel katalog/fiyat/stoğu, reset kilidi ve yinelenen istek server tarafında doğrulanmalı.
- Kayıtlı belge markalı yazdırılabilir fiş sunmalı; ürün/miktar/fiyat, toplam, ödeme yöntemi, varsa müşteri ve %20 KDV matrah/KDV/toplamı görünmeli. Çıktı iç kullanım satış belgesidir; resmî e-Fatura/e-Arşiv değildir.
- Cari reset mevcut onaylı kapsamı korur; bağımsız `cashSales`, stok kataloğu ve stok hareket geçmişini silmez.
- Kanıt: Preview'da katalog seçimi, varsayılan miktar, %20 KDV dâhil tutar/matrah/KDV gösterildi; testte kayıt yapılmadı. Rules Emulator aktif üye okuma/client yazma reddini doğruladı; Admin Function Emulator atomik stok düşümü, belge numarası, müşteri cari bakiyesinin değişmemesi, aynı payload retry idempotency'si ve hatalı/eskimiş/yetersiz stok/reset/pasif üye reddini doğruladı. `pnpm test:cash-sales-validation`, `pnpm test:money`, `pnpm test:inventory`, `pnpm build` ve `git diff --check` geçti.
