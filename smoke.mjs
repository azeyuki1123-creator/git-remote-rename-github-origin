import { chromium } from "playwright";

const OUT = process.env.SHOT_DIR ?? ".";
const B = "http://localhost:3000";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

async function go(path) {
  const r = await page.goto(B + path, { waitUntil: "networkidle" });
  if (r.status() >= 400) errors.push(`${path} -> ${r.status()}`);
}

async function expectText(label, needle) {
  try {
    await page.locator(`text=${needle}`).first().waitFor({ timeout: 10000 });
    console.log(`ok   ${label}`);
  } catch {
    console.log(`FAIL ${label} (expected "${needle}")`);
    errors.push(`${label}: "${needle}" not found`);
  }
}

// 分析ページは記録が無いときは空状態になる
await go("/analysis");
await expectText("空状態の案内", "分析には記録が必要です");

// 学習時間を記録
await go("/");
await page.selectOption("#log_subject", "不動産登記法");
await page.fill("#minutes", "90");
await page.click('button:has-text("記録する")');
await expectText("学習時間が反映される", "1.5h");

// 苦手を手入力で記録
await go("/mistakes/new");
await page.selectOption("#subject", "民法");
await page.selectOption("#field", "担保物権");
await page.selectOption("#source", "過去問");
await page.fill("#source_detail", "令和5年度 午前 第12問");
await page.selectOption("#cause", "似た制度との混同");
await page.fill("#memo", "根抵当権の元本確定事由で迷った");
await page.click('button:has-text("保存する")');
await page.waitForURL("**/mistakes");
await expectText("苦手が保存される", "令和5年度 午前 第12問");

// 復習して間隔反復が進む
await page.click('button:has-text("うろ覚え")');
await expectText("復習が記録される", "1回復習");
await page.screenshot({ path: `${OUT}/shot-mistakes.png`, fullPage: true });

// 模試結果
await go("/results");
await page.fill("#exam_name", "第2回 全国模試");
await page.fill('input[aria-label="民法 正答数"]', "12");
await page.fill('input[aria-label="不動産登記法 正答数"]', "8");
await page.fill('input[aria-label="会社法・商法 正答数"]', "4");
await page.fill('input[aria-label="憲法 正答数"]', "3");
await page.click('button:has-text("保存する")');
await page.waitForURL("**/results");
await expectText("成績が保存される", "第2回 全国模試");
await page.screenshot({ path: `${OUT}/shot-results.png`, fullPage: true });

// 傾向分析
await go("/analysis");
await expectText("失点見込みの見出し", "問を落とす計算");
await expectText("分野別の集計", "担保物権");
await expectText("未計測の区別", "未計測");
await page.screenshot({ path: `${OUT}/shot-analysis.png`, fullPage: true });

// 計画
await go("/plan");
await page.fill("#exam_date", "2027-07-04");
await page.click('button:has-text("保存")');
await expectText("残り日数", "本試験まで残り");
await page.locator('button:text-is("追加")').first().click();
await expectText("提案タスクを採用できる", "追加済み");
await page.screenshot({ path: `${OUT}/shot-plan.png`, fullPage: true });

// フィルタ
await go("/mistakes?filter=due");
await go(`/mistakes?subject=${encodeURIComponent("民法")}`);
await expectText("科目で絞り込める", "令和5年度 午前 第12問");

await go("/");
await page.screenshot({ path: `${OUT}/shot-home.png`, fullPage: true });

console.log(errors.length ? `\n${errors.length} 件の問題:\n${errors.join("\n")}` : "\nすべて成功");
await browser.close();
process.exit(errors.length ? 1 : 0);
