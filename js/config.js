/* =========================================================
   Chorus — 設定ファイル
   書き換えるのは基本このファイルだけでOK！

   ▼ Miiboで作るエージェントは合計6体。
      それぞれの「APIキー」と「エージェントID」をセットで貼る。

     1. ChatGPT用（裏方）        → 下の workers.chatgpt へ
     2. Claude用（裏方）         → 下の workers.claude へ
     3. Gemini用（裏方）         → 下の workers.gemini へ
     4. MultiAi-Authentic（統合役）→ models の authentic の agent へ
     5. MultiAi-XHigh（統合役）   → models の xhigh の agent へ
     6. Max（単体で完結）         → models の max の agent へ

   ▼ 動きのしくみ
     ・MultiAi系  : 質問 → ChatGPT/Claude/Gemini に同時送信
                    → 3体の回答を全部まとめて統合役に送信 → 最終回答
     ・Max       : 質問 → Maxエージェント → 回答（1回で完結）
   ========================================================= */

const CONFIG = {

  miibo: {
    endpoint: "https://api-mebo.dev/api",   // 基本このまま
  },

  /* ---------- ① 素材AI（MultiAi系の裏方3体） ---------- */
  workers: {
    chatgpt: {
      apiKey:  "",   // ← ChatGPT用エージェントのAPIキー
      agentId: "",   // ← ChatGPT用エージェントのID
    },
    claude: {
      apiKey:  "",   // ← Claude用エージェントのAPIキー
      agentId: "",   // ← Claude用エージェントのID
    },
    gemini: {
      apiKey:  "",   // ← Gemini用エージェントのAPIキー
      agentId: "",   // ← Gemini用エージェントのID
    },
  },

  /* ---------- ② 統合用の指示文 ----------
     3体の回答を統合役（MultiAi / XHigh）に渡す時の文章。
     {question} {chatgpt} {claude} {gemini} の部分が自動で置き換わる。
     好きに書き換えてOK。 */
  multiPrompt:
    "【ユーザーの質問】\n{question}\n\n" +
    "【ChatGPTの回答】\n{chatgpt}\n\n" +
    "【Claudeの回答】\n{claude}\n\n" +
    "【Geminiの回答】\n{gemini}\n\n" +
    "上の3つの回答の良いところを見抜いて組み合わせ、ユーザーの質問への最高の回答をひとつ作ってください。回答だけを出力してください。",

  /* ---------- ③ AIモデル ---------- */
  models: [
    {
      id: "authentic",
      name: "MultiAi-Authentic",
      tagline: "Gemini・GPT・Claudeが考え、GPT最先端モデルが最高の答えに統合する。",
      type: "multi",                 // 3体に聞いてから統合する方式
      agent: {                       // ← 統合役（MultiAi本体）のキーとID
        apiKey:  "",
        agentId: "",
      },
      cost: 200,
      icon: "assets/icon-authentic.png",
      thinking: ["ChatGPT・Claude・Gemini に質問中", "回答を受信中", "GPT 最先端モデルが統合中"],
      minThinkMs: 2800,
    },
    {
      id: "xhigh",
      name: "MultiAi-XHigh",
      tagline: "Authenticの進化版。さらに深く考える分、時間とクレジットを多く使う。",
      type: "multi",
      agent: {                       // ← 統合役（XHigh本体）のキーとID
        apiKey:  "",
        agentId: "",
      },
      cost: 800,
      icon: "assets/icon-xhigh.png",
      thinking: ["ChatGPT・Claude・Gemini に質問中", "回答を受信中", "深く再思考中", "XHigh が最終統合中"],
      minThinkMs: 7000,
    },
    {
      id: "max",
      name: "Max",
      tagline: "雑なプロンプトも磨き上げられて、Claude Fable5 が答える。",
      type: "direct",                // 1体だけで完結する方式
      agent: {                       // ← MaxエージェントのキーとID
        apiKey:  "",
        agentId: "",
      },
      cost: 400,
      icon: "assets/icon-max.png",
      thinking: ["各AIがプロンプトを強化中", "Fable5 へ転送中", "Fable5 が思考中"],
      minThinkMs: 3600,
    },
  ],

  /* ---------- ④ クレジット ---------- */
  credits: {
    signupBonus: 10000,   // アカウント作成でもらえる
    timesBonus: 90000,    // times参加でもらえる
    timesChannel: "#times_みんなの雑談_allin",
  },

  /* ---------- ⑤ Firebase ----------
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
