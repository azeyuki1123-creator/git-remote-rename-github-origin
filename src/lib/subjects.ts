export type Slot = "午前" | "午後" | "記述";

export type Subject = {
  name: string;
  slot: Slot;
  /** 本試験での出題数(択一)。記述式は 0。 */
  questions: number;
  fields: string[];
};

export const SUBJECTS: Subject[] = [
  {
    name: "憲法",
    slot: "午前",
    questions: 3,
    fields: ["人権総論", "精神的自由", "経済的自由", "人身の自由", "社会権", "参政権", "統治機構", "裁判所", "財政・地方自治"],
  },
  {
    name: "民法",
    slot: "午前",
    questions: 20,
    fields: ["総則", "物権総論", "占有権", "所有権・用益物権", "担保物権", "債権総論", "債権各論", "不法行為", "親族", "相続"],
  },
  {
    name: "刑法",
    slot: "午前",
    questions: 3,
    fields: ["刑法総論", "共犯", "罪数", "個人的法益", "社会的法益", "国家的法益"],
  },
  {
    name: "会社法・商法",
    slot: "午前",
    questions: 9,
    fields: ["商法総則・商行為", "設立", "株式", "機関", "計算", "資金調達", "組織再編", "持分会社", "解散・清算"],
  },
  {
    name: "民事訴訟法",
    slot: "午後",
    questions: 5,
    fields: ["裁判所・当事者", "訴えの提起", "審理", "証拠", "判決", "上訴・再審", "複雑訴訟", "簡易裁判所の特則"],
  },
  {
    name: "民事執行法",
    slot: "午後",
    questions: 1,
    fields: ["総則", "不動産執行", "動産・債権執行", "担保権の実行", "非金銭執行"],
  },
  {
    name: "民事保全法",
    slot: "午後",
    questions: 1,
    fields: ["保全命令", "保全執行", "保全異議・取消"],
  },
  {
    name: "供託法",
    slot: "午後",
    questions: 3,
    fields: ["総論", "弁済供託", "執行供託", "保証供託", "供託物の払渡し"],
  },
  {
    name: "司法書士法",
    slot: "午後",
    questions: 1,
    fields: ["業務", "義務・責任", "懲戒", "司法書士法人"],
  },
  {
    name: "不動産登記法",
    slot: "午後",
    questions: 16,
    fields: [
      "総論・登記手続",
      "所有権の登記",
      "抵当権の登記",
      "根抵当権の登記",
      "用益権の登記",
      "仮登記",
      "相続関係の登記",
      "区分建物",
      "表示に関する登記",
      "その他の登記",
    ],
  },
  {
    name: "商業登記法",
    slot: "午後",
    questions: 8,
    fields: ["総論・登記手続", "設立の登記", "株式・新株予約権", "機関の登記", "資本金の額の変更", "組織再編の登記", "解散・清算", "持分会社の登記", "外国会社・その他"],
  },
  {
    name: "記述式(不動産登記)",
    slot: "記述",
    questions: 0,
    fields: ["事実関係の読取り", "登記の可否判断", "申請件数・順序", "登記の目的・原因", "添付書面", "登録免許税", "枠ずれ"],
  },
  {
    name: "記述式(商業登記)",
    slot: "記述",
    questions: 0,
    fields: ["事実関係の読取り", "登記の可否判断", "申請件数・順序", "登記すべき事項", "添付書面", "登録免許税", "役員変更"],
  },
];

export const SUBJECT_NAMES = SUBJECTS.map((s) => s.name);

export function getSubject(name: string): Subject | undefined {
  return SUBJECTS.find((s) => s.name === name);
}

export function fieldsOf(name: string): string[] {
  return getSubject(name)?.fields ?? [];
}

/** 択一の総出題数 (70問) */
export const TOTAL_CHOICE_QUESTIONS = SUBJECTS.reduce((a, s) => a + s.questions, 0);

export const SOURCES = ["過去問", "模試", "答練", "テキスト", "問題集", "その他"] as const;
export type Source = (typeof SOURCES)[number];

export const CAUSES = [
  "知識が抜けていた",
  "条文の暗記不足",
  "先例・判例の知識不足",
  "問題文の読み違い",
  "似た制度との混同",
  "手続の流れの理解不足",
  "計算ミス",
  "時間不足",
  "ケアレスミス",
] as const;
export type Cause = (typeof CAUSES)[number];
