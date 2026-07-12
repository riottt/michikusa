import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "プライバシーポリシー | MICHIKUSA",
  description: "MICHIKUSAにおける位置情報とGoogle Calendar連携の取り扱い。"
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <p className="legal-page__eyebrow">MICHIKUSA</p>
      <h1>プライバシーポリシー</h1>
      <p>最終更新日: 2026年7月11日</p>

      <h2>取得する情報</h2>
      <p>現在地またはユーザーが入力した出発地点、外出条件、作成したルート、Google Calendar連携を許可した場合の空き時間情報とMICHIKUSAが作成した予定の識別子を扱います。</p>

      <h2>Google Calendarの利用</h2>
      <p>予定のタイトル・本文・参加者は読み取りません。空き時間の確認にはfreeBusy情報のみを使用し、予定はユーザーが「この道草で出発」を選択した後に、MICHIKUSA専用の副Calendarへ作成または更新します。</p>

      <h2>保存と保護</h2>
      <p>Google OAuthのアクセストークンとリフレッシュトークンは暗号化して保存します。APIキーとサーバー側の秘密情報は公開ページやブラウザへ送信しません。</p>

      <h2>共有</h2>
      <p>正確な自宅位置、出発地点、Google Calendarの予定名、OAuth情報を共有カードに含めません。法令上必要な場合を除き、個人情報を第三者へ販売しません。</p>

      <h2>お問い合わせ</h2>
      <p>本ポリシーに関するお問い合わせは、<a href="mailto:rio@aim.repair">rio@aim.repair</a> までご連絡ください。</p>

      <p className="legal-page__back"><Link href="/">MICHIKUSAへ戻る</Link></p>
    </main>
  );
}
