/* =========================================================
   Chorus — 設定ファイル
   基本的に、書き換えるのはこのファイルだけでOK！
   ========================================================= */

const CONFIG = {

  /* ---------- ① Miibo（AIとの接続） ----------
     miiboの管理画面 → 「API」タブ で取得できる。
     ・APIキーは1つだけ
     ・エージェントIDはモデルごとに設定できる
       （3つとも同じIDでもOK。その場合は同じAIが答える） */
  miibo: {
    apiKey: "",                               // ← ここにMiiboのAPIキーを貼る
    endpoint: "https://api-mebo.dev/api",     // 基本このまま
  },

  /* ---------- ② AIモデル ----------
     cost = 1回送信ごとに消費するクレジット
     agentId = このモデルが使うMiiboのエージェントID */
  models: [
    {
      id: "authentic",
      name: "MultiAi-Authentic",
      tagline: "Gemini・GPT・Claudeの思考を、GPT最先端モデルがひとつに統合する。",
      cost: 200,
      icon: "assets/icon-authentic.png",
      agentId: "",                            // ← MiiboのエージェントID
      thinking: ["Gemini が思考中", "GPT が思考中", "Claude が思考中", "GPT 最先端モデルが統合中"],
      minThinkMs: 2800,
    },
    {
      id: "xhigh",
      name: "MultiAi-XHigh",
      tagline: "Authenticの進化版。深く長く考える分、時間とクレジットを多く使う。",
      cost: 800,
      icon: "assets/icon-xhigh.png",
      agentId: "",                            // ← MiiboのエージェントID
      thinking: ["3モデルが並列思考中", "思考を深化中", "相互検証中", "XHigh が最終統合中"],
      minThinkMs: 7000,
    },
    {
      id: "max",
      name: "Max",
      tagline: "雑なプロンプトも他のAIが磨き上げて、Claude Fable5 に渡す。",
      cost: 400,
      icon: "assets/icon-max.png",
      agentId: "",                            // ← MiiboのエージェントID
      thinking: ["各AIがプロンプトを強化中", "Fable5 へ転送中", "Fable5 が思考中"],
      minThinkMs: 3600,
    },
  ],

  /* ---------- ③ クレジット ---------- */
  credits: {
    signupBonus: 10000,   // アカウント作成でもらえる
    timesBonus: 90000,    // times参加でもらえる
    timesChannel: "#times_みんなの雑談_allin",
  },

  /* ---------- ④ Firebase ----------
     Firebaseコンソール → プロジェクトの設定（歯車）→ マイアプリ(Web) にある
     firebaseConfig の中身を、そのままここにコピペする。

     例：
     firebase: {
       apiKey: "AIzaSyXXXXXXXXXXXXXXXX",
       authDomain: "chorus-xxxx.firebaseapp.com",
       projectId: "chorus-xxxx",
       storageBucket: "chorus-xxxx.appspot.com",
       messagingSenderId: "123456789",
       appId: "1:123456789:web:abcdef123456",
     },

     ★空のままでも動く（＝デモモード）。
       デモモードではアカウントやクレジットが「この端末のブラウザ内」にだけ保存される。 */
  firebase: {
  },
};
