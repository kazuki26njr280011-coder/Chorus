/* =========================================================
   Chorus — 設定ファイル（v2.0）
   書き換えるのは基本このファイルだけでOK！

   ▼ Miiboで作るエージェントは合計7体。
      それぞれの「APIキー」と「エージェントID」をセットで貼る。

     1. ChatGPT用（裏方）        → 下の workers.chatgpt へ
     2. Claude用（裏方）         → 下の workers.claude へ
     3. Gemini用（裏方）         → 下の workers.gemini へ
     4. MultiAi-Authentic（統合役）→ models の authentic の agent へ
     5. MultiAi-XHigh（統合役）   → models の xhigh の agent へ
     6. Max（単体で完結）         → models の max の agent へ
     7. Tachyon（超高速・単体）   → models の tachyon の agent へ

   ▼ 動きのしくみ
     ・MultiAi系  : 質問 → ChatGPT/Claude/Gemini に同時送信
                    → 3体の回答を全部まとめて統合役に送信 → 最終回答
     ・Max/Tachyon: 質問 → そのエージェント → 回答（1回で完結）
     ・/direct    : 好きなAIに1回だけ直接送信
     ・対論モード : 選んだ2体が停止するまで交互に討論
   ========================================================= */

const CONFIG = {

  miibo: {
    endpoint: "https://api-mebo.dev/api",   // 基本このまま
  },

  /* ---------- ① 素材AI（MultiAi系の裏方3体。対論・/directでも使う） ---------- */
  workers: {
    chatgpt: {
      apiKey:  "ee6ba86b-53e3-4171-8344-b467c7cbb8b919f026c4daa170",   // ← ChatGPT用エージェントのAPIキー
      agentId: "a76816c9-812c-428e-b9a0-ef17a58f1f8419f026b9125f3",   // ← ChatGPT用エージェントのID
    },
    claude: {
      apiKey:  "4f085292-54bb-41d1-b9e2-b8cd9a950db819f026492b920e",   // ← Claude用エージェントのAPIキー
      agentId: "5bb691be-5752-40f5-a48d-bbcd3f33091c",   // ← Claude用エージェントのID
    },
    gemini: {
      apiKey:  "c44d01b1-4023-4886-9c6c-a718f6ca8a9819f026854e1199",   // ← Gemini用エージェントのAPIキー
      agentId: "3eab2e54-0dee-459a-82f0-efef4556ac4c19f026812d6359",   // ← Gemini用エージェントのID
    },
  },

  /* ---------- ② /direct で裏方AIに送る時の消費クレジット ---------- */
  directCost: 100,

  /* ---------- ③ 統合用の指示文 ----------
     {question} {chatgpt} {claude} {gemini} が自動で置き換わる。 */
  multiPrompt:
    "【ユーザーの質問】\n{question}\n\n" +
    "【ChatGPTの回答】\n{chatgpt}\n\n" +
    "【Claudeの回答】\n{claude}\n\n" +
    "【Geminiの回答】\n{gemini}\n\n" +
    "上の3つの回答の良いところを見抜いて組み合わせ、ユーザーの質問への最高の回答をひとつ作ってください。回答だけを出力してください。" +
    "また、見出し・箇条書き・空行での段落分けを使って、読みやすく整えてください。",

  /* ---------- ④ 対論モード ----------
     {theme}=テーマ {position}=自分の立場 {opponent}=相手 {context}=状況
     {last}=相手の直前の主張 */
  debate: {
    costPerTurn: 150,   // 1ターン（1発言）ごとの消費クレジット
    prompt:
      "あなたはディベート大会に出場している討論者です。\n" +
      "テーマ: {theme}\n" +
      "あなたの立場: {position}\n" +
      "相手: {opponent}\n\n" +
      "ルール（絶対厳守）:\n" +
      "・絶対に相手に同意しない。「それもいいですね」「一理ある」「たしかに」等の同調・譲歩表現は禁止\n" +
      "・常に自分の立場を貫き、相手の主張の矛盾や弱点を具体的に指摘して反論する\n" +
      "・根拠か具体例を必ず1つ以上入れる\n" +
      "・250文字以内。挨拶や前置きは不要、いきなり主張から始める\n\n" +
      "{context}",
    firstContext: "あなたが先攻です。最初の主張を述べてください。",
    replyContext: "相手の直前の主張:\n「{last}」\nこれに真っ向から反論し、自分の立場を主張してください。",
  },

  /* ---------- ⑤ AIモデル ---------- */
  models: [
    {
      id: "authentic",
      name: "MultiAi-Authentic",
      tagline: "Gemini・GPT・Claudeが考え、GPT最先端モデルが最高の答えに統合する。",
      type: "multi",
      agent: {
        apiKey:  "eb863532-56cc-4d87-9a70-ead9b239b3f419f026e07751a7",
        agentId: "202d890f-c947-4d6f-8c6b-2119553ec14d19f026dbdf63bc",
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
      agent: {
        apiKey:  "0b201e85115683e09ea6c12f375240047a4748f2488f009d205fd7ecb65b4bc7",
        agentId: "10691d95-ef02-4627-97c2-a924dc46a218",
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
      type: "direct",
      agent: {
        apiKey:  "a443d20f253fee26efc830b4fcfcbefb33015628b73b9bec948bf29027de6628",
        agentId: "21691ab6-a04d-459d-ac0a-c50a91f5d02c",
      },
      cost: 400,
      icon: "assets/icon-max.png",
      thinking: ["各AIがプロンプトを強化中", "Fable5 へ転送中", "Fable5 が思考中"],
      minThinkMs: 3600,
    },
    {
      id: "tachyon",
      name: "Tachyon",
      tagline: "超絶高速。考えるより先に、答えが届く。",
      type: "direct",
      agent: {
        apiKey:  "f1856797e4cd893e771ff75e628d986cb59caab0e13e516f17357f7512620244",
        agentId: "360a332b-215d-4ade-94e6-69a4868e363e",
      },
      cost: 100,
      icon: "assets/a.png",
      thinking: ["Tachyon が光速思考中"],
      minThinkMs: 700,
    },
  ],

  /* ---------- ⑥ クレジット ---------- */
  credits: {
    signupBonus: 300,
    timesBonus: 7000,
    timesChannel: "#times_みんなの雑談_allin",
  },

  /* ---------- ⑦ アップデート履歴（設定→アップデート履歴タブに表示） ---------- */
  updates: [
    {
      version: "v2.0",
      date: "2026-07-03",
      items: [
        "対論モードを追加：2体のAIが1つのテーマで停止するまで討論",
        "コマンドモードを追加：「/」でパレット表示（/help /direct /multi /debate /clear）",
        "新AI「Tachyon」を追加：超高速応答",
        "設定にアップデート履歴タブを追加",
      ],
    },
    {
      version: "v1.2",
      date: "2026-07-03",
      items: ["AI回答の整形表示（見出し・箇条書き・段落分け）", "改行なし長文の自動段落分け"],
    },
    {
      version: "v1.1",
      date: "2026-07-03",
      items: ["マルチAIパイプライン実装（3体並列→統合役）", "ブラウザキャッシュ対策"],
    },
    {
      version: "v1.0",
      date: "2026-07-03",
      items: ["初回リリース：アカウント・クレジット・times特典・3モデル・履歴連携"],
    },
  ],
