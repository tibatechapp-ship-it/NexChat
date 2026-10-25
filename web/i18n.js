window.I18N = {
  ar: { tagline:"خيطٌ يربط، لا يقطع", login:"دخول", register:"حساب جديد", stories:"ستوريات (24 ساعة)", post:"نشر", close:"إغلاق", send:"إرسال", newChat:"محادثة جديدة", newGroup:"مجموعة جديدة", create:"إنشاء", noMessages:"لا رسائل بعد. ابدأ المحادثة!", typing:"يكتب...", joined:"انضم", left:"غادر", attach:"إرفاق", logout:"خروج" },
  en: { tagline:"A thread that binds, not breaks", login:"Login", register:"Sign up", stories:"Stories (24h)", post:"Post", close:"Close", send:"Send", newChat:"New chat", newGroup:"New group", create:"Create", noMessages:"No messages yet. Say hi!", typing:"typing...", joined:"joined", left:"left", attach:"Attach", logout:"Logout" },
  fr: { tagline:"Un fil qui lie, pas qui rompt", login:"Connexion", register:"S'inscrire", stories:"Stories (24h)", post:"Publier", close:"Fermer", send:"Envoyer", newChat:"Nouveau chat", newGroup:"Nouveau groupe", create:"Créer", noMessages:"Pas encore de messages.", typing:"écrit...", joined:"a rejoint", left:"a quitté", attach:"Joindre", logout:"Déconnexion" },
  es: { tagline:"Un hilo que une, no rompe", login:"Entrar", register:"Registrarse", stories:"Stories (24h)", post:"Publicar", close:"Cerrar", send:"Enviar", newChat:"Nuevo chat", newGroup:"Nuevo grupo", create:"Crear", noMessages:"Sin mensajes aún.", typing:"escribiendo...", joined:"se unió", left:"salió", attach:"Adjuntar", logout:"Salir" },
  tr: { tagline:"Bağlayan bir ip, kırmayan", login:"Giriş", register:"Kayıt ol", stories:"Hikayeler (24s)", post:"Paylaş", close:"Kapat", send:"Gönder", newChat:"Yeni sohbet", newGroup:"Yeni grup", create:"Oluştur", noMessages:"Henüz mesaj yok.", typing:"yazıyor...", joined:"katıldı", left:"ayrıldı", attach:"Ekle", logout:"Çıkış" },
  ru: { tagline:"Нить, что связывает", login:"Вход", register:"Регистрация", stories:"Истории (24ч)", post:"Опубликовать", close:"Закрыть", send:"Отправить", newChat:"Новый чат", newGroup:"Новая группа", create:"Создать", noMessages:"Сообщений пока нет.", typing:"печатает...", joined:"присоединился", left:"вышел", attach:"Прикрепить", logout:"Выход" },
  zh: { tagline:"连接的丝线", login:"登录", register:"注册", stories:"动态 (24小时)", post:"发布", close:"关闭", send:"发送", newChat:"新聊天", newGroup:"新建群组", create:"创建", noMessages:"暂无消息。", typing:"正在输入...", joined:"加入了", left:"离开了", attach:"附件", logout:"退出" },
  ja: { tagline:"結ぶ糸、切らない", login:"ログイン", register:"登録", stories:"ストーリー (24時間)", post:"投稿", close:"閉じる", send:"送信", newChat:"新しいチャット", newGroup:"新しいグループ", create:"作成", noMessages:"まだメッセージがありません。", typing:"入力中...", joined:"が参加", left:"が退出", attach:"添付", logout:"ログアウト" },
  ko: { tagline:"연결하는 실", login:"로그인", register:"가입", stories:"스토리 (24시간)", post:"게시", close:"닫기", send:"전송", newChat:"새 채팅", newGroup:"새 그룹", create:"만들기", noMessages:"아직 메시지가 없습니다.", typing:"입력 중...", joined:"참여", left:"나감", attach:"첨부", logout:"로그아웃" },
  de: { tagline:"Ein Faden, der verbindet", login:"Anmelden", register:"Registrieren", stories:"Stories (24h)", post:"Posten", close:"Schließen", send:"Senden", newChat:"Neuer Chat", newGroup:"Neue Gruppe", create:"Erstellen", noMessages:"Noch keine Nachrichten.", typing:"tippt...", joined:"ist beigetreten", left:"hat verlassen", attach:"Anhängen", logout:"Abmelden" },
  pt: { tagline:"Um fio que liga", login:"Entrar", register:"Cadastrar", stories:"Stories (24h)", post:"Publicar", close:"Fechar", send:"Enviar", newChat:"Novo chat", newGroup:"Novo grupo", create:"Criar", noMessages:"Sem mensagens ainda.", typing:"digitando...", joined:"entrou", left:"saiu", attach:"Anexar", logout:"Sair" },
  it: { tagline:"Un filo che unisce", login:"Accedi", register:"Registrati", stories:"Storie (24h)", post:"Pubblica", close:"Chiudi", send:"Invia", newChat:"Nuova chat", newGroup:"Nuovo gruppo", create:"Crea", noMessages:"Nessun messaggio.", typing:"sta scrivendo...", joined:"si è unito", left:"è uscito", attach:"Allega", logout:"Esci" },
};
window.applyI18n = function (locale) {
  const dict = window.I18N[locale] || window.I18N.ar;
  document.documentElement.lang = locale;
  document.documentElement.dir = (locale === "ar") ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (dict[key]) el.textContent = dict[key];
  });
  // update placeholders for inputs with data-i18n-placeholder
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (dict[key]) el.placeholder = dict[key];
  });
};
