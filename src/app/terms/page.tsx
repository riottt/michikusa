import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "利用規約 | MICHIKUSA",
  description: "MICHIKUSAの利用条件。"
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <p className="legal-page__eyebrow">MICHIKUSA</p>
      <h1>利用規約</h1>
      <p>最終更新日: 2026年7月11日</p>

      <h2>サービスについて</h2>
      <p>MICHIKUSAは、現在地・空き時間・予算・移動手段などをもとに外出ルートの候補を提案するサービスです。提案は参考情報であり、安全、営業時間、経路、交通状況を保証するものではありません。</p>

      <h2>Google Calendar連携</h2>
      <p>Calendarへの書き込みは、ユーザーが明示的に出発を選択した場合に限ります。ユーザーはいつでもGoogleアカウントの権限管理画面またはMICHIKUSAの接続解除機能から連携を解除できます。</p>

      <h2>安全な利用</h2>
      <p>外出中は周囲の状況、交通規則、施設の案内を優先してください。危険を感じる場合は提案に従わず、必要に応じて帰宅または安全な場所へ移動してください。</p>

      <h2>サービスの変更</h2>
      <p>提供者は、必要に応じてサービス内容または本規約を変更することがあります。</p>

      <p className="legal-page__back"><Link href="/">MICHIKUSAへ戻る</Link></p>
    </main>
  );
}
