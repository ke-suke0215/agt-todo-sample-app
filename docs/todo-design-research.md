# チャット付き Todo の UI 調査

## 配色とレイアウト

- **余白と文字で階層をつくる。** Atlassian Design System は背景と文字にニュートラル色を使い、彩度の高い色で意味や操作を強調している。今回のモックでは、青みのあるオフホワイトに濃紺の文字を置き、青紫を「Todo を追加」や「保存」などの主要操作とキーボードフォーカスに使う。一覧と詳細の外枠を省き、見出しの大きさと余白でまとまりをつくる。[Atlassian Design の色](https://atlassian.design/foundations/color/)・[余白](https://atlassian.design/foundations/spacing/)
- **一覧は細い横罫線で区切る。** GOV.UK のタスクリストは各行にタスク名と状態を並べ、完了状況を一覧で確認できる。モックではタイトルと詳細を開く矢印を一つのボタンにまとめ、行内のステータス選択欄とは隣接させる。行の余白からも詳細を開けるようにし、ステータス操作は独立させる。[GOV.UK Task list](https://design-system.service.gov.uk/components/task-list/)・[HTML Standard の button 要素](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element)
- **チャットは一覧と詳細に重ねて右下に固定する。** パネルを白い面と影で区切る。狭い画面ではパネルの幅を画面内に収め、Todo の末尾にはパネルの高さに応じた余白を設けて、重なった内容をスクロールで表示できるようにする。追加フォームも狭い画面では入力欄を縦に並べる。[WCAG 2.2 の Reflow](https://www.w3.org/TR/WCAG22/#reflow)

## 編集とフィードバック

- **ステータスは一覧と詳細の両方で変更できる。** Atlassian の Lozenge を参考に「未着手」「進行中」「完了」の文字を淡い色面に載せる。編集には下向き矢印とラベルを備えた選択欄を使い、各行のラベルには対象の Todo 名を含める。変更は一覧と詳細の両方に即時に反映する。[Atlassian Design の Lozenge](https://atlassian.design/components/lozenge/lozenge/)・[WCAG 2.2 の Use of Color](https://www.w3.org/TR/WCAG22/#use-of-color)・[Headings and Labels](https://www.w3.org/TR/WCAG22/#headings-and-labels)
- **詳細はラベル付きの複数行入力で編集する。** 「詳細」の `textarea` に保存済みの文章を表示し、編集時の改行を保存して再表示する。両画面から使えるヘッダーに「Todo を追加」を置き、追加フォームでも同じ入力形式を使う。[GOV.UK Textarea](https://design-system.service.gov.uk/components/textarea/)・[GOV.UK Button](https://design-system.service.gov.uk/components/button/)
- **共有チャットは履歴と入力欄を同じ場所に置く。** 一覧と詳細から同じチャット履歴を参照できるようにし、チャットで Todo を追加したら一覧を更新して結果を会話に表示する。履歴を `role="log"` にすると、履歴にフォーカスを移さず新着メッセージを支援技術に通知できる。[W3C WAI のチャットでの `role="log"` 使用例](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23)
- **小さな操作にも視認性を確保する。** Tab キーで詳細ボタンとステータス選択欄を順に操作でき、現在のフォーカスが見えることを確認する。通常サイズの文字は 4.5:1 以上、操作や状態の識別に必要な非テキストの表示は該当箇所で 3:1 以上とする。ポインター操作の領域は 24×24 CSS px 以上を基本とする。[WCAG 2.2 の Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)・[Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)・[Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)・[Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)
