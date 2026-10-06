/** Lightweight markdown → HTML for chat (escaped, no raw HTML from model). */
(function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  function closeOpenFence(text) {
    const count = (text.match(/```/g) || []).length;
    if (count % 2 === 1) {
      return `${text}\n\`\`\``;
    }
    return text;
  }

  function inlineMarkdown(escaped) {
    let s = escaped;
    s = s.replace(/`([^`\n]+)`/g, "<code class=\"md-inline\">$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function renderBlock(block) {
    const trimmed = block.trim();
    if (!trimmed) return "";

    const lines = trimmed.split("\n");
    const m = /^#{1,3}\s+(.+)$/.exec(lines[0]);
    if (m && lines.length === 1) {
      const level = lines[0].match(/^#+/)[0].length;
      const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      return `<${tag} class="md-heading">${inlineMarkdown(escapeHtml(m[1]))}</${tag}>`;
    }

    if (lines.every((l) => /^(\s*[-*]\s+|\s*\d+\.\s+)/.test(l))) {
      const items = lines
        .map((l) => l.replace(/^(\s*[-*]\s+|\s*\d+\.\s+)/, ""))
        .map((l) => `<li>${inlineMarkdown(escapeHtml(l))}</li>`)
        .join("");
      return `<ul class="md-list">${items}</ul>`;
    }

    if (lines.length > 1 && lines.every((l) => /^>\s?/.test(l))) {
      const inner = lines
        .map((l) => l.replace(/^>\s?/, ""))
        .map((l) => inlineMarkdown(escapeHtml(l)))
        .join("<br />");
      return `<blockquote class="md-quote">${inner}</blockquote>`;
    }

    const paras = trimmed.split(/\n{2,}/);
    return paras
      .map((p) => {
        const one = p.replace(/\n/g, "<br />");
        return `<p>${inlineMarkdown(escapeHtml(one))}</p>`;
      })
      .join("");
  }

  function renderMarkdown(raw, streaming) {
    const source = streaming ? closeOpenFence(String(raw ?? "")) : String(raw ?? "");
    const parts = [];
    const re = /```(\w*)\n?([\s\S]*?)```/g;
    let last = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      if (match.index > last) {
        parts.push({ type: "text", body: source.slice(last, match.index) });
      }
      parts.push({ type: "code", lang: match[1] || "", body: match[2].replace(/\n$/, "") });
      last = re.lastIndex;
    }
    if (last < source.length) {
      parts.push({ type: "text", body: source.slice(last) });
    }

    return parts
      .map((part) => {
        if (part.type === "code") {
          const lang = part.lang ? ` data-lang="${escapeHtml(part.lang)}"` : "";
          return `<pre class="md-pre"${lang}><code>${escapeHtml(part.body)}</code></pre>`;
        }
        return renderBlock(part.body);
      })
      .join("");
  }

  window.blankCloudMarkdown = { renderMarkdown, escapeHtml };
})();
