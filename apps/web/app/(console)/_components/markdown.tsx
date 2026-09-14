import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 服务端渲染 markdown，无 prose 插件——用组件映射给基础排版
export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-6 [&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-500 dark:[&_blockquote]:border-neutral-700 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:text-xs dark:[&_code]:bg-neutral-800 [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-neutral-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-200 [&_th]:bg-neutral-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left dark:[&_th]:border-neutral-700 dark:[&_th]:bg-neutral-900 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
