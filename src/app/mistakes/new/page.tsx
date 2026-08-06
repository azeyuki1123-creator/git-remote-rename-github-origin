import { PageTitle } from "@/components/ui";
import { isConfigured } from "@/lib/analyze";
import { MistakeForm } from "./MistakeForm";

export const dynamic = "force-dynamic";

export default function NewMistakePage() {
  return (
    <>
      <PageTitle
        title="間違えたところを記録する"
        sub="写真を撮って送るだけ。科目・分野・押さえるべき論点はAIが読み取ります。"
      />
      <MistakeForm aiAvailable={isConfigured()} />
    </>
  );
}
