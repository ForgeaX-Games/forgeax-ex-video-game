import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

const CSS = `
.gdx-author-frame{box-sizing:border-box;height:100%;min-height:0;display:flex;justify-content:center;padding:24px 120px 40px;overflow:hidden;background:#201d1a}
.gdx-paper{box-sizing:border-box;width:100%;max-width:862px;height:100%;min-height:0;overflow-x:hidden;overflow-y:auto;background:#1d1b1a;scrollbar-width:thin;scrollbar-color:transparent transparent}
.gdx-paper:hover{scrollbar-color:rgba(255,255,255,.28) transparent}
.gdx-paper::-webkit-scrollbar{width:8px}.gdx-paper::-webkit-scrollbar-track{background:transparent}.gdx-paper::-webkit-scrollbar-thumb{border-radius:8px;background:transparent}.gdx-paper:hover::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28)}
.gdx-prose{font-family:'PingFang SC',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;font-weight:400;line-height:1.5;color:rgba(255,255,255,.8);overflow-wrap:anywhere}
.gdx-prose h1,.gdx-prose h2,.gdx-prose h3{color:rgba(255,255,255,.9);font-weight:500;line-height:1.5;margin:0 0 24px}
.gdx-prose h1{font-size:24px}.gdx-prose h2{margin:30px 0 24px;border-bottom:1px solid var(--20,rgba(255,255,255,.20));font-size:18px}.gdx-prose h3{font-size:16px}
.gdx-prose hr{display:none}
.gdx-prose p,.gdx-prose ul,.gdx-prose ol,.gdx-prose blockquote{margin:0 0 24px}.gdx-prose ul,.gdx-prose ol{padding-left:24px}.gdx-prose li+li{margin-top:8px}
.gdx-prose blockquote{padding-left:16px;border-left:2px solid #f6972e;color:rgba(255,255,255,.6)}.gdx-prose blockquote>:last-child{margin-bottom:0}
.gdx-prose code{padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.1);font-family:ui-monospace,monospace;font-size:.88em}.gdx-prose pre{overflow:auto;margin:0 0 24px;padding:14px;background:#151311}.gdx-prose pre code{padding:0;background:transparent}
.gdx-prose table{width:100%;margin:0 0 24px;border-collapse:collapse;font-size:14px;line-height:1.5}.gdx-prose th,.gdx-prose td{padding:10px 12px;border:1px solid rgba(255,255,255,.18);text-align:left;vertical-align:top}.gdx-prose th{color:#fff;background:rgba(255,156,42,.12);font-weight:600}.gdx-prose tr:nth-child(even) td{background:rgba(255,255,255,.025)}
@media (max-width:1100px){.gdx-author-frame{padding-right:48px;padding-left:48px}}
@media (max-width:760px){.gdx-author-frame{padding:16px 20px 24px}}
`

export function AuthorDocumentView({ markdown }: { markdown: string }): JSX.Element {
  injectStyleOnce('game-author-document', CSS)
  return (
    <div className="gdx-author-frame">
      <article className="gdx-paper">
        <div className="gdx-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      </article>
    </div>
  )
}
