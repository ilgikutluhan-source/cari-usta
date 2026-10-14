# Çalışkanlar Yapı Market — Cari Hesap Yönetimi

İşletme sahibinin yönettiği çalışan hesaplarıyla aynı cari defteri farklı bilgisayarlarda açan Türkçe, mobil uyumlu Firebase/Netlify uygulaması.

## Özellikler

- Müşteri cari hesapları, arama/filtreleme, borç, tahsilat, bakiye ve ödeme vadesi takibi.
- Uygulamanın her sekmesinde tek bir **Cari Ekle** düğmesi; müşteri adı ve telefonunu müşteri detayından düzenleme.
- Ad/telefon düzenlemesi canlı olarak ortak cari defterine yansır; Firestore kuralları bakiye, vade ve hareket kayıtlarının bu işlemle değiştirilmesini engeller.
- Borç ve tahsilat alanları Türkçe TL tutarlarını (ör. `1.250,50`) kabul eder; kuruş hassasiyeti iki hanede tutulur ve tahmini kalan bakiye yazarken anında güncellenir.
- Telefon numarasında boşlukları veya tutarda binlik noktalarını elle eklemek gerekmez: alanlar yazarken otomatik biçimlendirir. Kuruş için virgül kullanılır; binlik noktası sonrası rakam girişi yanlışlıkla kuruş hanesine dönüşmez.
- Atomik cari hareketleri: borç/tahsilat, hareket ve aktivite kaydı aynı işlemde yazılır; yeni canlı hareketler tamsayı `amountCents` taşır, alt-kuruş/çelişkili tutar Rules tarafından reddedilir; toplamlar kuruş bazında normalize edilir ve borç kapanınca vade temizlenir.
- Sahip onaylı çalışan hesapları: kullanıcı, e-posta ve ilk şifreyi uygulamadaki **Kullanıcılar** ekranından yalnızca işletme sahibi oluşturur. İlk şifre Firestore'a yazılmaz.
- Herkese açık kayıt bağlantısı olmayan e-posta/şifre girişi.
- Mevcut işletme UID'si altındaki ortak veri yolları, farklı oturumlarda Firestore `onSnapshot` ile canlı eşitlenir.
- Cariyi geri alınabilir biçimde arşivleme ve geri yükleme. Cari ve hareket geçmişi korunur, değişiklik bütün kullanıcıların ekranlarına yansır.
- Siyah-kırmızı-beyaz Çalışkanlar Yapı Market teması, mobil uyumlu tablolar ve drawer'lar.
- Üst çubuktan erişilen açık/koyu görünüm seçeneği; ilk açılış cihazın renk tercihini kullanır, kullanıcının seçimi aynı tarayıcıda hatırlanır. Karanlık tema giriş, kurulum, formlar ve yönetim ekranlarında çalışır; ekstre/fiş baskısı beyaz kalır.
- Üst çubuktaki zil menüsü son tahsilatları ve gecikmiş/yaklaşan vade hatırlatmalarını listeler; bildirim satırından ilgili cari detayı açılır. Hatırlatmalar mevcut vade durumuyla hesaplanır ve **Vade Takvimi** ekranının akışını değiştirmez.
- Müşteri detayındaki tek **Satış** formu mevcut çalışan cari borç hareketini kullanır; isteğe bağlı ürün satırları eklenince satır/genel toplamı kuruş hassasiyetinde hesaplar ve ürünleri fiyatlarıyla kaydeder. Girilen satış fiyatları %20 KDV dâhildir.
- Ürün eklenmese de mevcut elle tutar girişi korunur. KDV dâhil brüt satış toplamı ve müşterinin cari borcu değişmeden kalır; her yeni Satış hareketi %20 KDV oranını, matrahı ve KDV tutarını tamsayı kuruş olarak kaydeder. Para tahsil edildiğinde ayrı **Tahsilat al** hareketiyle kaydedilir. Yeni satışlar Netlify Admin Function secret'larına bağlı değildir.
- Müşterinin kronolojik cari ekstresi A4, seçilen satışın fişi sabit 80×80 mm kare sayfadır; her iki çıktıda %20 oran, KDV hariç matrah, KDV ve KDV dâhil brüt toplam görünür. Ekstre yazdırılabilir, PDF olarak kaydedilebilir ve WhatsApp hatırlatmasına PDF dosyası eklenerek paylaşılabilir.
- Pozitif bakiyeli müşteri için PDF ekstreli Türkçe WhatsApp hatırlatması: uyumlu telefonlarda sistem paylaşım menüsünden WhatsApp seçilir; bilgisayarda PDF indirilip WhatsApp Web sohbetine kullanıcı tarafından eklenir. Mesajı kontrol ve gönderim kullanıcıya aittir; uygulama otomatik mesaj göndermez ve WhatsApp API entegrasyonu kullanmaz.
- Kullanıcılar alanında owner-only veri sıfırlama; kapsam uyarısı ve `SIFIRLA` ikinci onayıyla aktif/arşiv cari ve hareketleri temizler, çalışan girişlerini ve üyelikleri korur.
- Ayrı **Stok Takibi** alanı: ortak ürün kataloğu, açılış stoku, stok girişi/düzeltmesi, düşük stok uyarısı ve ürün başına hareket geçmişi.
- Satış formunda stok katalogundan ürün seçimi; seçilen miktar satış/cari hareketiyle aynı Firestore transaction'ında atomik düşer. Manuel ürün satırları ve elle girilen tutar stoktan düşmez; stok yetmezse satış reddedilir.

> **Tahsilat kaydı, çevrimiçi ödeme alma işlemi değildir.** Uygulama işletmenin aldığı tahsilatı deftere işler; kart/banka tahsilatı veya ödeme kuruluşu entegrasyonu içermez.

Ürünlü satış çıktısı iç cari takip fişi/ekstresidir; resmî e-Fatura/e-Arşiv yerine geçmez. Stoktan seçilmeyen manuel ürün satırları stok miktarını değiştirmez.

## Satış kaydı (borç formuna entegre)

Müşteri detayından **Satış** seçin. Ürün satırı eklemeden mevcut elle tutar, tarih, vade ve açıklama girişini kullanabilirsiniz. Ürün satırı eklendiğinde en fazla 25 satırda ürün adı, miktar (en fazla 3 ondalık), birim ve KDV dâhil birim fiyatı girilir; stok kataloğundaki ürün seçilirse ad, birim ve fiyat otomatik doldurulur. Satır ve satış toplamı otomatik hesaplanır ve tutar alanının yerine geçer. Cari tutar brüt satış toplamı olarak kalır; brütten matrah `round(brüt kuruş × 5/6)`, %20 KDV ise brüt eksi matrah hesabıyla kuruş hassasiyetinde ayrıştırılır. Ürün satırları ve KDV alanları aynı cari borç hareketinde kaydedilir. Stok katalogundan seçilen satırlar, stok miktarıyla aynı Firestore transaction'ında doğrulanıp düşülür; miktar yetersizse cari hareketi de kaydedilmez. Bu akış satış sırasında tahsilat almaz; alınan para için **Tahsilat al** düğmesini ayrıca kullanın.

Müşteri kartındaki **Ekstreyi yazdır / PDF** hareketleri kronolojik sıralar, açılış/devir tutarını, her hareket sonrası bakiyeyi, güncel bakiyeyi ve KDV dâhil satışların %20 oran/matrah/KDV özetini gösterir; satış kartındaki yazdır simgesi seçilen hareketi sabit 80×80 mm kare sayfada basar. Vergi alanı olmayan geçmiş ürünlü satışlar %20 KDV dâhil kabul edilerek mevcut brüt tutardan ayrıştırılır; ürün bilgisi olmayan eski borçlar KDV satış özetine eklenmez. Eski ürün satırları ve hareketler korunur. Cari çıktı resmî e-Fatura/e-Arşiv değildir.

## Stok takibi

Yan menüden **Stok Takibi** alanını açın. Yeni üründe ürün adı, isteğe bağlı stok kodu, birim, KDV dâhil satış fiyatı, düşük stok eşiği ve varsa açılış miktarını girin. Ürün kartından stok girişi ya da sayım düzeltmesi işleyebilir ve geçmiş hareketleri inceleyebilirsiniz. Ürünler silinmez; arşivlenip tekrar etkinleştirilebilir. Uyarı eşiği ve miktarlar en fazla 3 ondalık basamakla saklanır.

Cari detayındaki **Satış** formunun üstündeki **Stoktan hızlı ürün seç** alanı ürünü ek satır açmadan sepete ekler; ürün adı, birimi ve KDV dâhil katalog fiyatı otomatik alınır, miktar düzenlenebilir. Serbest ürün/tutar ile borç girişi eskisi gibi kullanılabilir ve katalog stoğunu düşürmez. Katalog ürünüyle satış, `/api/stock/sale` üzerinden güncel fiyat/stok kontrolüyle tek Admin Firestore transaction'ında cari harekete ve stok hareketine yazılır. Ürün birden çok satırda seçilirse miktarlar gruplanır; yetersiz stok, değişmiş fiyat veya reset kilidi varsa işlem tamamen reddedilir. Veri, aynı işletme sahibi UID'si altındaki etkin çalışan üyeleri arasında anlık senkronize edilir.

## Peşin Satış

Yan menüdeki **Peşin Satış** sekmesinde aktif katalog ürünlerini sepete ekleyin, miktarları ve ödeme yöntemini (nakit, kart/POS, havale/EFT veya diğer) seçin; tarih ve açıklama girebilir, isterseniz belgeye müşteri ekleyebilirsiniz. Sistem %20 KDV dâhil ürün toplamını, matrahı ve KDV'yi kuruş hassasiyetinde gösterir. **Peşin satışı kaydet** hem satış belgesini hem stok düşümünü atomik yapar. Müşteri seçimi yalnızca belgeye tarihsel ad/telefon kopyası ekler; cari bakiye, borç/tahsilat toplamları, müşteri işlemleri ve cari aktivite değişmez.

Son 100 peşin satış belgesi tüm yetkili cihazlarda gerçek zamanlı görünür; belge arama ve 80×80 mm fiş yazdırma vardır. Bu çıktı iç kullanım satış belgesidir; resmî e-Fatura/e-Arşiv entegrasyonu değildir. **Cari verilerini sıfırla** mevcut onaylanmış cari kapsamını korur: müşteri/cari kayıtlarını temizler fakat bağımsız Peşin Satış belgelerini, stok kataloğunu veya stok hareket geçmişini silmez.

## Yerelde çalıştırma

Gereksinimler Node.js 22 ve pnpm 11'dir. `pnpm install` ve `pnpm dev` komutlarını çalıştırın. Firebase ayarları hiç yoksa uygulama yalnızca bu tarayıcıda saklanan açıkça etiketli örnek veriyi gösterir. Firebase web ayarları var ancak `VITE_CARI_OWNER_UID` yoksa uygulama güvenlik için canlı veri ekranını kapatıp kurulum uyarısı gösterir. Tahsilat/satış tutarı yazılırken binlik noktaları ve Türkçe ondalık virgülü anında biçimlendirilir; örneğin `140000` yazımı `140.000`, kuruş için `1250,50` yazımı `1.250,50` olarak gösterilir. Büyük tutarlar kuruş hassasiyetiyle ayrıştırılır. Üretim derlemesi `pnpm build` komutuyla React uygulamasını ve Netlify Function TypeScript denetimini doğrular. `pnpm test:money`, `pnpm test:inventory` ve `pnpm test:cash-sales-validation` para, stok ve peşin satış doğrulama regresyonlarını çalıştırır. Firestore Rules ve Admin Function bütünleşik senaryoları yalnızca Firebase Emulator altında `pnpm test:firestore-rules` ve `pnpm test:stock-sale-function` komutlarıyla çalıştırın.

Yerel `.env.local` dosyasını `.env.example` temelinde doldurun. Gerçek çalışan şifreleri, Firebase Admin private key'i veya başka bir sunucu secret'ını `.env.local`, Git deposu ya da sohbete koymayın; Admin secret'ları yalnızca Netlify Function ortamında tanımlanmalıdır.

## Firebase kurulumu

1. Firebase Console'da mevcut Firebase projesinin **Web App** yapılandırmasındaki `apiKey`, `authDomain`, `projectId` ve `appId` değerlerini kullanın.
2. Authentication > Sign-in method bölümünde **E-posta/Şifre** sağlayıcısını açın. İşletme sahibinin mevcut e-posta/şifre hesabı aynı UID ile kullanılmalıdır.
3. Firestore Database'i kullanın. Cari yolları `users/{ownerUid}/customers/{customerId}`, `users/{ownerUid}/customers/{customerId}/transactions/{transactionId}` ve `users/{ownerUid}/activity/{transactionId}` olarak kalır. Stok ürünleri `users/{ownerUid}/inventory/{productId}`, stok giriş/düzeltme/satış geçmişi `users/{ownerUid}/stockActivity/{movementId}` altındadır. Ortak erişim listesi `users/{ownerUid}/members/{memberUid}` konumundadır. Eski cariler taşınmaz; sahibi UID'si değişirse eski defter otomatik eşlenmez.
4. Peşin satış belgeleri `users/{ownerUid}/cashSales/{saleId}` altında saklanır; yalnızca aktif owner/staff üyeleri okuyabilir. İstemci bu koleksiyona yazamaz; belgeleri `/api/cash/sale` Admin Function'ı oluşturur.
5. Firebase Authentication > Users bölümünden **işletme sahibinin mevcut hesabının UID** değerini alın. Netlify build değişkeni `VITE_CARI_OWNER_UID` olarak bu UID girilmelidir. Bu UID gizli değildir; başka kullanıcı UID'siyle değiştirilmemelidir. Boş değer kurulum uyarısı üretir; boş olmayan yanlış değer otomatik doğrulanamaz, farklı bir üyelik alanına işaret edebilir. Dağıtımdan önce mevcut owner UID'siyle birebir eşleştiğini kontrol edin.
6. Firebase Authentication > Settings > Authorized domains bölümüne canlı alan adını (`cari-usta.netlify.app`) ve kullanılacak özel alan adını ekleyin.
7. Proje kökündeki güncel `firestore.rules` dosyasını yayımlayın. Proje için Firebase CLI'ı yetkili bir ortamda çalıştırın ve doğru Firebase projesini seçtikten sonra `firebase deploy --only firestore:rules` komutunu kullanın. Üyelik kuralları eski UID başlık belgelerini korur; üye olmayan veya pasif üyeyi reddeder; yalnızca owner'ın kendi üyeliğini ilk kez kurmasına izin verir. Cari hareketlerinde kuruş/KDV ve transaction-activity eşitliğini; stok kuralları üye yetkisini, ürün alan aralıklarını ve giriş/düzeltme hareketinin ürün miktarı geçişiyle aynı transaction'da eşleşmesini zorunlu kılar. İstemci itemized cari satış, cashSales yazımı ve doğrudan `sale` stok hareketi yapamaz; Function'lar doğrulanmış Admin transaction'ı kullanır. Cari/ürün fiziksel silme ve geçmiş hareket güncellemesi kapalıdır. Sıfırlama sırasında `users/{ownerUid}/system/ledgerReset` koruma belgesi cari/stok satış yazımlarını geçici durdurur.

Firestore Rules'u yayımlamadan çalışanları eklemeyin. Güvenlik kurallarını herkese açık okuma/yazma (`allow read, write: if true`) olarak ayarlamayın.

## Netlify site ve function ayarları

Bu proje statik Vite sitesi ve sunucu tarafında `create-team-user`, `reset-ledger`, `stock-sale` ve `cash-sale` Netlify Function'ları olarak dağıtılır. Çalışan oluşturma Function'ı owner ID token'ını doğrular; reset Function'ı owner üyeliğini zorunlu tutar. Stoklu cari satış ve bağımsız peşin satış Function'ları Firebase ID token'ını, etkin owner/staff üyeliğini, katalog/stoğu ve reset kilidini sunucuda doğrular; satış stok güncellemesi Firebase Admin transaction'ında yapılır. Yalnızca UI'dan kayıt bağlantısını kaldırmak tek başına güvenlik sağlamaz; Firestore Rules istemci satış yazımlarını ayrıca reddeder.

Katalog ürünlü cari satış `/api/stock/sale` Function'ına gider; cari başlığı, transaction/activity kopyaları, ürün miktarı ve `stockActivity` tek Firebase Admin transaction'ında yazılır. `src/sales-validation.ts` ürün satırlarını, kuruş ve toplam eşitliğini doğrular; Firestore Rules istemciden `items`/`stockDeltas` içeren satışları ve doğrudan `sale` stockActivity yazımını reddeder. Bağımsız Peşin Satış `/api/cash/sale` Function'ında `cashSales`, stok miktarı ve stockActivity'yi aynı transaction'a yazar; seçilen müşteri yalnızca belgeye kopyalanır, cari bakiye/transactions/activity değişmez. Aynı payload ve `saleId` ile tekrar deneme önceki belgeyi döndürür; farklı payload aynı idempotency anahtarını kullanamaz. Her iki işlemde KDV dâhil ürün toplamı ve %20 KDV alanları kuruş hassasiyetindedir; `system/ledgerReset` varken yeni satış yazılmaz.

Netlify'da ayrı `cari-usta` sitesinin site ayarlarında şu **build-scoped** değişkenleri tanımlayın:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_CARI_OWNER_UID` — Firebase Authentication'daki mevcut işletme sahibi UID'si

Çalışan oluşturma, cari sıfırlama, stoklu cari satış ve Peşin Satış Function'ları için şu değerleri **Functions runtime scope** ile tanımlayın. Bu Admin değerleri tarayıcı formuna veya frontend bundle'ına eklenmez. Bunları bu sohbet mesajına veya Git'e koymayın:

- `FIREBASE_PROJECT_ID` — Firebase proje ID'si
- `FIREBASE_OWNER_UID` — `VITE_CARI_OWNER_UID` ile aynı owner UID
- `FIREBASE_ADMIN_CLIENT_EMAIL` — Firebase Console > Project settings > Service accounts altında oluşturulan hizmet hesabının `client_email` alanı
- `FIREBASE_ADMIN_PRIVATE_KEY` — aynı indirilmiş JSON dosyasının `private_key` alanı. Netlify'nın güvenli ortam değişkeni formuna girin; JSON dosyasını veya private key'i kimseyle paylaşmayın, kaynak koda/commit'e eklemeyin. Değeri değiştirdikten sonra yeni bir Netlify deploy gerekir.

Hizmet hesabı anahtarı yetkili bir Firebase proje yöneticisi tarafından üretilmeli ve yalnızca gerekli erişime sahip olmalıdır. Netlify'ın Function environment limitini aşmamak için JSON dosyasının tamamını bir değişkene koymayın; yalnızca listelenen alanları tanımlayın. Function yanıtları hassas işlem verisi taşımamalı; uygulama parola veya token loglamaz.

`pnpm-workspace.yaml`, Firebase Admin 14'ün `jwks-rsa` bağımlılığının Netlify CommonJS runtime'ında kullandığı `jose` sürümünü `5.10.0` olarak sabitler. `jwks-rsa` 4.1.x'in `jose` 6'yı senkron `require()` etmesi Netlify Functions'ta `ERR_REQUIRE_ESM` hatası verebildiği için bu override'ı upstream paket düzeltmesi doğrulanana kadar ve lockfile ile birlikte koruyun ([upstream issue](https://github.com/auth0/node-jwks-rsa/issues/507)).

`netlify.toml` build komutu `pnpm install --frozen-lockfile && pnpm build`, publish dizini `dist`, Functions dizini `netlify/functions` olarak ayarlanır. Bir environment değişkeni değiştirildiğinde yayın yeniden derlenip dağıtılmalıdır.

Bu tek işletme sitesinde Firebase Web ayarları ve owner UID'si **public client configuration** olduğu için Netlify build environment'ta da tanımlıdır; `netlify.toml` bu değerleri upload-based deploy'larda frontend build'e geçirir. Bu değerler tarayıcı bundle'ında görünür olmalıdır. Firebase Admin private key ve service-account client email hiçbir zaman `netlify.toml` veya frontend bundle'ına koyulmaz; bunlar yalnızca Netlify Functions secret scope'unda kalır.

### Önemli Firebase Authentication sınırı

Firebase Web API anahtarı gizli değildir. E-posta/şifre sağlayıcısı Firebase'de etkin olduğunda, Firebase'in public sign-up API'si teknik olarak Auth'ta üyelik kaydı olmayan hesaplar oluşturabilir. Uygulamada halka açık kayıt formu yoktur; owner dışındaki hesaplar yalnızca veri alanına üyelikleri oluşturulmuşsa cari kayıtlarına ulaşabilir. Firestore Rules üyelik belgesi olmayan kullanıcıları her zaman reddeder. Firebase Console'daki Auth kullanıcı listesinde yetkisiz/boşta hesaplar görünebilir, ancak bunlar ortak cari verisine erişemez.

## Veri modeli ve silme davranışı

Mevcut owner UID'nin cari başlık belgeleri, cari altındaki işlem belgeleri ve activity kayıtları aynen korunur. Her borç/tahsilat/vade değişikliği tek Firestore transaction içinde cari başlığıyla eşleştirilir. Firestore canlı dinleyicileri diğer bilgisayarlarda yeni kayıtları ve arşiv değişikliğini günceller.

Peşin Satış belgeleri de `cashSales` koleksiyonunun canlı dinleyicisiyle owner ve etkin çalışanların diğer cihazlarında görünür; bu ayrı arşiv cari hareket listesini değiştirmez.

Müşteri detayındaki **Bilgileri düzenle** eylemi adı ve telefon numarasını günceller; Firestore kuralları yalnızca bu profil alanları ile `updatedAt` değişikliğine izin verir. Borç, tahsilat, bakiye, vade, arşiv durumu ve cari hareketleri bu işlemle değiştirilemez. Güncel müşteri bilgisi açık oturumlarda canlı eşitlenir; eski hareketlerdeki müşteri adı işlem anındaki tarihsel kayıt olarak kalır.

Cariyi arşivlemek aktif listeden kaldırır ama müşteri ve hareket kayıtlarını fiziksel olarak silmez; owner veya çalışan **Arşiv** alanından hareket geçmişini doğrudan görüntüleyebilir ve cari kaydını geri yükleyebilir. Bu tasarım muhasebe geçmişini korur. Örnek demo kayıtlarını gerçek işletme hesabına aktarım veya dış muhasebe dosyalarından toplu içe aktarma aracı yoktur.

## Stok ve ürünlü satış güvenliği

Stok ürünleri `users/{ownerUid}/inventory/{productId}`, açılış/giriş/düzeltme/satış hareketleri `users/{ownerUid}/stockActivity/{movementId}` altında tutulur. Katalogdan ürün seçilen (veya serbest ürün satırı eklenen) satış, Firebase ID token'ıyla `/api/stock/sale` Netlify Function'a gider. Function token'ın geçerliliğini/revocation durumunu ve aktif owner/staff üyeliğini doğrular; transaction sırasında reset kilidini, güncel müşteri bakiyesini, ürünün aktifliğini/fiyatını ve eldeki stoğu yeniden okur. Cari toplamı, satış ile activity kopyaları, stok miktarı ve stok hareketi aynı Firebase Admin Firestore transaction'ında yazılır; istenen stok mevcut değilse, ürün fiyatı değişmişse, reset kilidi varsa veya istek yinelenmişse hiçbir satış yazımı yapılmaz. Aynı ürün birden çok satırda bulunursa toplam miktar tek stok düşümünde birleştirilir. Serbest ürün satırları hareket/ekstrede saklanır fakat katalog stok miktarını azaltmaz.

İstemci Firestore Rules `items` veya `stockDeltas` alanı taşıyan cari hareketlerini ve doğrudan `sale` stok hareketini reddeder; bu yazılar yalnızca Function'ın yönetici yetkisiyle ve yukarıdaki kontrollerden geçtikten sonra oluşabilir. Açılış, stok girişi ve sayım düzeltmesi normal üye transaction'ında ürün belgesiyle hareket belgesini atomik eşleştirir; reset kilidi istemci stok yazımını da durdurur. Ürünlü satış için Netlify Function environment'ında mevcut Firebase Admin değişkenleri (`FIREBASE_PROJECT_ID`, `FIREBASE_OWNER_UID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`) Functions scope'unda tanımlı olmalıdır; Admin private key frontend'e veya `netlify.toml` dosyasına konmamalıdır.

## Peşin Satış belgesi

**Peşin Satış** sekmesi aktif stok kataloğundan bir veya daha çok ürün ve miktar seçer; ödeme yöntemi, tarih, açıklama ve isteğe bağlı müşteri yalnızca belgeye yazılır. Ürün fiyatı kayıt öncesinde sunucuda katalogla karşılaştırılır. `cashSales` belgesi, stok miktarı ve `stockActivity` hareketi tek Admin Firestore transaction'ında oluşturulur; müşterinin cari bakiyesi, borç/tahsilat toplamı, cari transaction veya activity kaydı değişmez. Aynı `saleId` ve aynı içerikle tekrar denenirse mevcut belge döner; farklı içeriği aynı ID ile yazma girişimi reddedilir.

Fiş çıktısı sabit **80×80 mm** termal yazıcı sayfasıdır; %20 KDV dâhil toplamı, ayrıştırılmış matrah/KDV'yi, ödeme yöntemini ve belge numarasını içerir. Bu kayıt iç satış belgesidir; resmi e-Fatura/e-Arşiv veya GİB gönderimi değildir. Cari sıfırlama yalnızca önceden onaylanmış cari kayıt/işlem/activity kapsamını temizler; bağımsız Peşin Satış belgeleri, stok kataloğu ve stok hareket geçmişi korunur. Sıfırlama kilidi açıkken iki satış Function'ı da yeni satış yazımını reddeder.

## Owner-only sıfırlama ve WhatsApp hatırlatması/PDF

**Kullanıcılar** ekranındaki **Ortak cari verilerini sıfırla** paneli yalnızca işletme sahibine gösterilir. Önce silinecek kayıtların kapsamını açıklayan uyarı açılır; devam için `SIFIRLA` yazılmalıdır. Function ID token'ını doğrular, token UID'sinin `FIREBASE_OWNER_UID` ile aynı olduğunu ve owner üyeliğinin etkin olduğunu kontrol eder. Yalnızca `users/{ownerUid}/customers` kayıtlarını ve bu müşterilerin `transactions` alt koleksiyonlarını, ayrıca `users/{ownerUid}/activity` belgelerini siler. **Firebase Authentication çalışan hesapları, `members` üyelik belgeleri ve Firebase/Netlify ayarları korunur.** Demo örnek verileri bu API'ye dahil değildir.

Silme tamamlanana kadar Firestore Rules istemci cari, satış ve tahsilat yazımlarını `system/ledgerReset` koruma belgesi üzerinden durdurur; başarılı sonuçta kilit kaldırılır ve ekranlar silinmiş listeleri canlı olarak alır. Kilit her denemeye özgü işlem kimliği taşır; eski bir reset isteği daha yeni denemenin kilidini bırakamaz veya hata durumuna çeviremez. Function işlem sırasında hata verirse defter güvenlik için yazmaya kapalı kalır; işletme sahibi aynı onaylı işlemi yeniden deneyerek kalan kayıtları temizleyip kilidi kaldırabilir. Sıfırlama geri alınamaz; başlamadan önce gerekli muhasebe yedeğini alın.

Pozitif bakiyeli müşteri detayında tek **WhatsApp’a PDF’li borç hatırlatması gönder** düğmesi A4 cari ekstresini ve hazır mesajı birlikte hazırlar. Mesaj müşterinin açık borç tutarını, kayıtlı vadesini (veya vade bilgisinin kayıtlı olmadığını) ve ödeme talebini içerir. Dosya paylaşımını destekleyen cihazlarda PDF ve mesaj paylaşım menüsüne taşınır; WhatsApp’ı seçtikten sonra alıcıyı ve mesajı kontrol edip **Gönder** düğmesine kullanıcı basar. Diğer cihazlarda PDF indirilir ve kişiye özel `wa.me` mesaj taslağı açılır; PDF sohbete elle eklenir. Hareketler, bakiye ve varsa KDV özeti PDF’de bulunur; cari verisi PDF üretmek için sunucuya yüklenmez. Uygulama otomatik mesaj/dosya göndermez ve WhatsApp API anahtarı kullanmaz. Telefon yoksa/geçersizse kullanıcıya müşteri kartındaki numarayı güncelleme uyarısı gösterilir.
