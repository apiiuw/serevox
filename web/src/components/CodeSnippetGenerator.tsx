import React, { useState } from 'react';
import { Copy, Check, Terminal, FileCode, Cpu, Globe } from 'lucide-react';

interface CodeSnippetModalProps {
  bucketName: string;
  objectKey: string;
  publicUrl: string;
  isPublic: boolean;
  mimeType: string;
}

export function CodeSnippetGenerator({
  bucketName,
  objectKey,
  publicUrl,
  isPublic,
  mimeType,
}: CodeSnippetModalProps) {
  const [lang, setLang] = useState<'curl' | 'ts' | 'python' | 'go' | 'html'>('curl');
  const [copied, setCopied] = useState(false);

  const directUrl = isPublic
    ? `${publicUrl}/v1/public/${bucketName}/${objectKey}`
    : `${publicUrl}/v1/authenticated/${bucketName}/${objectKey}?token=YOUR_SIGNED_TOKEN`;

  const isImage = mimeType.startsWith('image/') && mimeType !== 'image/svg+xml';

  const snippets: Record<typeof lang, { title: string; code: string }> = {
    curl: {
      title: 'cURL Command',
      code: isPublic
        ? `# Download public object\ncurl -f -O "${directUrl}"`
        : `# Download private object using Serevox REST Key\ncurl -f -H "X-Api-Key: $SEREVOX_API_KEY" \\\n     "${publicUrl}/v1/buckets/${bucketName}/objects/download?path=${objectKey}" \\\n     -o "${objectKey.split('/').pop() || 'downloaded'}"`,
    },
    ts: {
      title: 'TypeScript / Node (@serevox/sdk)',
      code: `import { createSerevoxClient } from '@serevox/sdk';

const serevox = createSerevoxClient({
  url: '${publicUrl}',
  apiKey: process.env.SEREVOX_SERVICE_KEY!,
});

${
  isPublic
    ? `// Get public CDN URL with on-the-fly thumbnail
const url = serevox.from('${bucketName}').getPublicUrl('${objectKey}'${
        isImage
          ? `, {
  transform: { width: 500, height: 500, fit: 'cover', format: 'jpeg', quality: 85 },
}`
          : ''
      });
console.log('CDN URL:', url);`
    : `// Download private object as Blob
const { data, error } = await serevox.from('${bucketName}').download('${objectKey}');
if (error) throw error;`
}`,
    },
    python: {
      title: 'Python (requests / boto3 S3)',
      code: `import requests

url = "${directUrl}"
${
  isPublic
    ? `res = requests.get(url)
with open("${objectKey.split('/').pop() || 'file'}", "wb") as f:
    f.write(res.content)`
    : `headers = {"X-Api-Key": "YOUR_SEREVOX_API_KEY"}
res = requests.get(url, headers=headers)
with open("${objectKey.split('/').pop() || 'file'}", "wb") as f:
    f.write(res.content)`
}`,
    },
    go: {
      title: 'Go (net/http)',
      code: `package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	req, _ := http.NewRequest("GET", "${directUrl}", nil)
${!isPublic ? '\treq.Header.Set("X-Api-Key", os.Getenv("SEREVOX_API_KEY"))\n' : ''}\tres, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()

	out, _ := os.Create("${objectKey.split('/').pop() || 'file'}")
	defer out.Close()
	io.Copy(out, res.Body)
	fmt.Println("Downloaded successfully!")
}`,
    },
    html: {
      title: isImage ? 'HTML <img> Tag' : 'HTML <a> Download Link',
      code: isImage
        ? `<img 
  src="${directUrl}?w=800&q=80&format=jpeg" 
  alt="${objectKey.split('/').pop()}" 
  loading="lazy" 
/>`
        : `<a href="${directUrl}" download="${objectKey.split('/').pop()}">
  Download ${objectKey.split('/').pop()}
</a>`,
    },
  };

  function copyCode() {
    navigator.clipboard.writeText(snippets[lang].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="rounded-xl border border-[#232a35] bg-[#0c1016] p-4 text-xs">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#1b222d] pb-2.5">
        <div className="flex items-center gap-1 font-semibold text-slate-300">
          <Terminal className="h-4 w-4 text-[#84c498]" />
          <span>Interactive Code Snippet Generator</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {(['curl', 'ts', 'python', 'go', 'html'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                lang === l
                  ? 'bg-[#417150] text-white'
                  : 'bg-[#151c25] text-slate-400 hover:text-slate-200'
              }`}
            >
              {l === 'curl' ? 'cURL' : l === 'ts' ? 'TypeScript' : l === 'go' ? 'Go' : l === 'python' ? 'Python' : 'HTML'}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded-lg bg-[#07090d] p-3 font-mono text-[11px] leading-relaxed text-[#b7e2c5]">
          {snippets[lang].code}
        </pre>
        <button
          type="button"
          onClick={copyCode}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-[#1f2835]/80 px-2 py-1 text-[10px] font-medium text-slate-300 backdrop-blur hover:bg-[#417150] hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

