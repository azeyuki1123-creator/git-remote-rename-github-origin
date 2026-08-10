// 動作確認用のサンプルデータを投入する。
//   node scripts/seed.js          … 空のテーブルにだけ投入
//   node scripts/seed.js --reset  … 既存データを消してから投入
import { db, all, get, run, tx } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const RESET = process.argv.includes('--reset');

// 再現性のある擬似乱数（同じデータが毎回できるように）
let seed = 20260810;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const BELTS = [
  ['白帯', '白', 1, '#f2f2f2', 15, 2],
  ['オレンジ帯', '橙', 2, '#e8963c', 20, 3],
  ['青帯', '青', 3, '#2f6fbf', 20, 3],
  ['黄帯', '黄', 4, '#e5c53c', 24, 4],
  ['緑帯', '緑', 5, '#3f9e63', 24, 4],
  ['紫帯', '紫', 6, '#7a4fbd', 30, 6],
  ['茶帯', '茶', 7, '#7a4a26', 36, 8],
  ['黒帯（初段）', '黒', 8, '#22201f', 48, 12],
];

const SKILLS = {
  白帯: [
    ['基本', '正拳中段突き'],
    ['基本', '上段揚げ受け'],
    ['基本', '前蹴り'],
    ['型', '太極その一'],
    ['体力', '腕立て伏せ 10 回'],
  ],
  オレンジ帯: [
    ['基本', '中段外受け'],
    ['基本', '回し蹴り'],
    ['型', '太極その二'],
    ['組手', '約束組手（一本目）'],
    ['体力', '腹筋 20 回'],
  ],
  青帯: [
    ['基本', '手刀受け'],
    ['基本', '横蹴り'],
    ['型', '平安初段'],
    ['組手', '約束組手（三本目まで）'],
    ['体力', '連続前蹴り 30 本'],
  ],
  黄帯: [
    ['基本', '前屈立ちの移動基本'],
    ['基本', '後ろ回し蹴り'],
    ['型', '平安二段'],
    ['組手', '自由組手 1 分'],
    ['体力', '正拳突き 100 本'],
  ],
  緑帯: [
    ['基本', '猫足立ちからの掛け受け'],
    ['型', '平安三段'],
    ['組手', '自由組手 2 分'],
    ['体力', '連続ミット打ち 3 ラウンド'],
  ],
  紫帯: [
    ['型', '平安四段'],
    ['組手', '自由組手 3 分'],
    ['指導', '下級生への基本指導'],
    ['体力', '正拳突き 200 本'],
  ],
  茶帯: [
    ['型', '平安五段'],
    ['型', '鉄騎初段'],
    ['組手', '連続組手 3 人'],
    ['指導', '準備運動のリード'],
  ],
  '黒帯（初段）': [
    ['型', '抜塞大'],
    ['組手', '連続組手 5 人'],
    ['指導', 'クラス指導の補助'],
  ],
};

const MEMBERS = [
  ['田中 拓海', 'たなか たくみ', '2011-05-02', '黄帯', 900, 'takumi@example.com', '田中 良子', 'premium'],
  ['佐藤 美咲', 'さとう みさき', '2013-08-19', '青帯', 620, 'misaki@example.com', '佐藤 健一', 'standard'],
  ['鈴木 蓮', 'すずき れん', '2010-01-30', '緑帯', 1300, 'ren@example.com', '鈴木 由美', 'premium'],
  ['高橋 陽菜', 'たかはし ひな', '2015-03-11', '白帯', 120, 'hina@example.com', '高橋 誠', 'standard'],
  ['伊藤 大輔', 'いとう だいすけ', '1996-11-07', '茶帯', 2400, 'daisuke@example.com', '', 'premium'],
  ['渡辺 さくら', 'わたなべ さくら', '2012-06-24', 'オレンジ帯', 300, 'sakura@example.com', '渡辺 智子', 'standard'],
  ['山本 颯', 'やまもと そう', '2014-09-15', '白帯', 90, 'sou@example.com', '山本 直人', 'standard'],
  ['中村 結衣', 'なかむら ゆい', '2009-02-28', '紫帯', 1700, 'yui@example.com', '', 'premium'],
  ['小林 悠真', 'こばやし ゆうま', '2013-12-03', '青帯', 700, 'yuma@example.com', '小林 千夏', 'standard'],
  ['加藤 莉子', 'かとう りこ', '2016-07-21', '白帯', 45, 'riko@example.com', '加藤 拓也', 'standard'],
  ['吉田 健吾', 'よしだ けんご', '1988-04-16', '黒帯（初段）', 3600, 'kengo@example.com', '', 'premium'],
  ['山田 陽翔', 'やまだ はると', '2012-10-09', '黄帯', 850, 'haruto@example.com', '山田 洋介', 'standard'],
];

const CONTENTS = [
  ['道場の心得と礼法', '空手', '入門したらまず読む、道場での礼儀と稽古の心構え。', null, 0,
    '道場に入るときは「押忍、お願いします」と一礼します。\n稽古着はいつも清潔に、帯は結び目を正しく。\n技を覚えることと同じくらい、あいさつと片づけを大切にしてください。', ''],
  ['正拳中段突きの基本', '型・基本', '引き手・腰の回転・軸足の使い方を分解して解説します。', '白帯', 0,
    '1. 引き手は脇腹まで強く引く\n2. 腰の回転と突きのタイミングを合わせる\n3. 突き終わりで軸足の膝が抜けないこと\n鏡の前で 10 本ずつ、ゆっくり確認しましょう。', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['平安初段の流れ', '型・基本', '青帯で覚える平安初段を分解して解説。', '青帯', 0,
    '演武線を意識して、方向転換のたびに視線を先に送ります。\n止まるところと流すところのメリハリが評価の分かれ目です。', ''],
  ['自由組手の間合いの作り方', '組手', '踏み込みの距離と、下がらない足さばき。', '黄帯', 0,
    '相手の前足の位置を基準に、自分の間合いを一定に保ちます。\n下がるのではなく、角度を変えて外すことを覚えましょう。', ''],
  ['試合で勝つためのメンタル準備', '組手', '当日の緊張を味方にするルーティン。', '緑帯', 1,
    '試合前日は新しい練習をしません。\n呼吸を 4 秒吸って 8 秒吐く。これを 3 セット行うと心拍が落ち着きます。', ''],
  ['成長期の食事とタンパク質', '栄養・食事', '身長を伸ばしながら筋力をつけるための食事。', null, 0,
    '体重 1kg あたり 1.2〜1.6g のタンパク質を目安にします。\n稽古後 30 分以内の補食（おにぎり＋牛乳など）が効果的です。\n※持病やアレルギーがある場合は必ず医師に相談してください。', ''],
  ['減量期の栄養管理', '栄養・食事', '試合前の体重調整を安全に行う考え方。', '緑帯', 1,
    '急激な水抜きはパフォーマンスを大きく落とします。\n1 週間で体重の 1% を上限に、糖質量を段階的に調整します。\n※未成年の減量は保護者と指導者の同意のもとで行ってください。', ''],
  ['家でできる体幹トレーニング', 'トレーニング', '道具なしで週 3 回、10 分のメニュー。', null, 0,
    'プランク 30 秒 × 3\nサイドプランク 20 秒 × 左右 2\nヒップリフト 15 回 × 3\n毎日やるより、しっかり効かせて週 3 回がおすすめです。', ''],
  ['蹴りが高く上がるストレッチ', 'トレーニング', '股関節まわりを段階的にほぐす。', 'オレンジ帯', 0,
    '稽古前は動的ストレッチ、稽古後は静的ストレッチ。\n痛みが出る手前で 20 秒キープを 2 セット。', ''],
  ['社会人のための時間の作り方', '仕事・法律', '仕事と稽古を両立させるスケジュール術。', '茶帯', 1,
    '週の予定を日曜に 15 分で組み立てる。\n稽古は「予定」ではなく「予約」として先にブロックします。', ''],
  ['法律試験対策：民法の学び方（会員無料）', '仕事・法律', '条文・判例・過去問の回し方を解説します。', '茶帯', 1,
    '条文 → 趣旨 → 要件効果の順に整理し、過去問で出題のされ方を確認します。\n※一般的な学習方法の紹介であり、個別の法律相談ではありません。', ''],
];

const EVENTS = [
  ['第32回 市民空手道選手権大会', '大会', 30, '市総合体育館', 16, 3000,
    '形・組手の両部門にエントリーできます。学年別・帯別のクラス分けです。'],
  ['夏季合同稽古会', '講習会', 55, '県立武道館', 40, 1500, '近隣道場との合同稽古。組手の実践練習を中心に行います。'],
  ['冬季昇級審査', '審査', 20, '本部道場', 10, 2000, '対象者には別途ご案内します。道着・帯・防具をご持参ください。'],
  ['第31回 市民空手道選手権大会', '大会', -120, '市総合体育館', null, 3000, '昨年度の大会です。'],
];

const TEMPLATES = [
  ['審査案内', '【{{belt}}】次回審査のご案内',
    '{{name}} 様\n\nいつも稽古お疲れさまです。\n{{name}} さんは次回審査（{{next_exam}}）の対象となりました。\n現在の帯：{{belt}}\n\n詳細は道場掲示とアプリでご確認ください。\n\n空手道場'],
  ['月次おたより', '{{name}} さんへ 今月の道場だより',
    '{{name}} 様\n\n今月もお疲れさまでした。\n次のイベント：{{next_event}}\n\n稽古の様子はアプリの「学びの部屋」でも配信しています。\n\n空手道場'],
];

function clear() {
  const tables = [
    'video_feedback', 'video_submissions', 'event_entries', 'events', 'exam_candidates', 'exams',
    'assessments', 'skill_items', 'attendance', 'training_sessions', 'mail_messages', 'mail_templates',
    'contents', 'members', 'auth_sessions', 'users', 'belts',
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  // AUTOINCREMENT を使っていないため sqlite_sequence は存在しないことがある
  const hasSequence = get("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'");
  if (hasSequence) db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('${tables.join("','")}')`);
}

function seedAll() {
  // 帯
  for (const [name, short, order, color, minSessions, minMonths] of BELTS) {
    run(
      'INSERT INTO belts (name, short_name, rank_order, color, min_sessions, min_months) VALUES (?, ?, ?, ?, ?, ?)',
      [name, short, order, color, minSessions, minMonths],
    );
  }
  const beltByName = new Map(all('SELECT * FROM belts').map((b) => [b.name, b]));

  // 技術項目
  for (const [beltName, items] of Object.entries(SKILLS)) {
    const belt = beltByName.get(beltName);
    items.forEach(([category, name], i) => {
      run('INSERT INTO skill_items (belt_id, category, name, sort_no) VALUES (?, ?, ?, ?)', [
        belt.id, category, name, i,
      ]);
    });
  }

  // 指導者アカウント
  const adminId = Number(
    run("INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)", [
      'sensei@dojo.test', hashPassword('dojo1234'), '道場長 井上',
    ]).lastInsertRowid,
  );

  // 生徒
  const memberIds = [];
  for (const [name, kana, birthday, beltName, daysAgo, email, guardian, plan] of MEMBERS) {
    const belt = beltByName.get(beltName);
    const joined = isoDaysAgo(daysAgo);
    const promoted = isoDaysAgo(Math.max(20, Math.floor(daysAgo * 0.25)));
    const userId = Number(
      run("INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'member', ?)", [
        email, hashPassword('dojo1234'), name,
      ]).lastInsertRowid,
    );
    const info = run(
      `INSERT INTO members (user_id, name, kana, birthday, belt_id, joined_on, last_promoted_on, phone, email,
                            guardian_name, plan, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [userId, name, kana, birthday, belt.id, joined, promoted, '090-0000-0000', email, guardian, plan],
    );
    memberIds.push(Number(info.lastInsertRowid));
  }

  // 稽古と出欠（過去 16 週、週 2 回）
  for (let week = 15; week >= 0; week -= 1) {
    for (const [offset, title] of [[3, '通常稽古（水）'], [0, '通常稽古（土）']]) {
      const held = isoDaysAgo(week * 7 + offset);
      const sessionId = Number(
        run('INSERT INTO training_sessions (held_on, title, place) VALUES (?, ?, ?)', [held, title, '本部道場'])
          .lastInsertRowid,
      );
      for (const memberId of memberIds) {
        const r = rand();
        const status = r < 0.72 ? 'present' : r < 0.82 ? 'late' : 'absent';
        run('INSERT INTO attendance (session_id, member_id, status) VALUES (?, ?, ?)', [
          sessionId, memberId, status,
        ]);
      }
    }
  }

  // 習熟度（在籍が長い生徒ほど高くなるように）
  for (const memberId of memberIds) {
    const member = get('SELECT * FROM members WHERE id = ?', [memberId]);
    const items = all('SELECT * FROM skill_items WHERE belt_id = ?', [member.belt_id]);
    for (const item of items) {
      const r = rand();
      const level = r < 0.15 ? 1 : r < 0.45 ? 2 : 3;
      run('INSERT INTO assessments (member_id, skill_item_id, level, comment) VALUES (?, ?, ?, ?)', [
        memberId, item.id, level, level >= 3 ? '審査でも通用するレベル' : '引き続き反復練習',
      ]);
    }
  }

  // コンテンツ
  for (const [title, category, summary, beltName, premium, body, video] of CONTENTS) {
    run(
      `INSERT INTO contents (title, category, summary, body, video_url, min_belt_id, is_premium, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [title, category, summary, body, video, beltName ? beltByName.get(beltName).id : null, premium],
    );
  }

  // イベント
  for (const [title, kind, daysAhead, place, deadlineDays, fee, detail] of EVENTS) {
    const startsOn = isoDaysAgo(-daysAhead);
    run(
      'INSERT INTO events (title, kind, starts_on, place, deadline_on, fee, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, kind, startsOn, place, deadlineDays ? isoDaysAgo(-deadlineDays) : null, fee, detail],
    );
  }
  const firstEvent = get('SELECT * FROM events ORDER BY starts_on LIMIT 1');
  for (const memberId of memberIds.slice(0, 5)) {
    run("INSERT INTO event_entries (event_id, member_id, status) VALUES (?, ?, 'entry')", [firstEvent.id, memberId]);
  }

  // 動画提出とフィードバック
  const videoSamples = [
    [memberIds[0], '平安二段 通し', '方向転換で軸がぶれている気がします。'],
    [memberIds[2], '回し蹴り 10 本', '蹴りの高さが安定しません。'],
    [memberIds[5], '太極その二', '初めての提出です。よろしくお願いします。'],
  ];
  videoSamples.forEach(([memberId, title, note], i) => {
    const id = Number(
      run('INSERT INTO video_submissions (member_id, title, note, url, status) VALUES (?, ?, ?, ?, ?)', [
        memberId, title, note, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', i === 0 ? 'reviewed' : 'pending',
      ]).lastInsertRowid,
    );
    if (i === 0) {
      run('INSERT INTO video_feedback (submission_id, author_id, comment, score) VALUES (?, ?, ?, ?)', [
        id, adminId,
        '方向転換の前に視線を送れているのが good です。' +
          '軸のブレは引き足が甘いことが原因なので、蹴った足をまっすぐ戻す練習を 20 本ずつ入れましょう。',
        78,
      ]);
    }
  });

  // 審査会とメールテンプレート
  const exam = run("INSERT INTO exams (name, held_on, place, note) VALUES (?, ?, ?, '')", [
    `${new Date().getFullYear()}年 冬季昇級審査`, isoDaysAgo(-20), '本部道場',
  ]);
  for (const [name, subject, body] of TEMPLATES) {
    run('INSERT INTO mail_templates (name, subject, body) VALUES (?, ?, ?)', [name, subject, body]);
  }

  return { members: memberIds.length, exam: Number(exam.lastInsertRowid) };
}

const existing = get('SELECT COUNT(*) AS c FROM members').c;
if (existing > 0 && !RESET) {
  console.log(`既にデータがあります（生徒 ${existing} 名）。作り直す場合は --reset を付けてください。`);
  process.exit(0);
}

tx(() => {
  if (RESET) clear();
  const result = seedAll();
  console.log(`サンプルデータを投入しました（生徒 ${result.members} 名）。`);
  console.log('指導者ログイン: sensei@dojo.test / dojo1234');
  console.log('会員ログイン  : takumi@example.com / dojo1234');
});
