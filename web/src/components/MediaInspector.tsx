import React, { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, FileText, Image as ImageIcon, Volume2, Video, Code, Check, Copy } from 'lucide-react';
import { formatBytes, getToken, StorageObject } from '../api';

interface MediaInspectorProps {
  bucketId: string;
  bucketName: string;
  obj: StorageObject;
  publicUrl: string;
  isPublic: boolean;
}

export function MediaInspectorModalContent({
  bucketId,
  bucketName,
  obj,
  publicUrl,
  isPublic,
}: MediaInspectorProps) {
  const [zoom, setZoom] = useState(100);
  const [naturalDim, setNaturalDim] = useState<{ w: number; h: number } | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [previewFormat, setPreviewFormat] = useState<'original' | 'webp' | 'jpeg'>('original');

  const previewSrc = `/console/api/buckets/${bucketId}/objects/preview?key=${encodeURIComponent(
    obj.key
  )}&console_token=${encodeURIComponent(getToken())}`;

  const isImage = obj.mime_type.startsWith('image/') && obj.mime_type !== 'image/svg+xml';
  const isVideo = obj.mime_type.startsWith('video/');
  const isAudio = obj.mime_type.startsWith('audio/');
  const isPDF = obj.mime_type === 'application/pdf';
  const isText =
    obj.mime_type.startsWith('text/') ||
    obj.mime_type.includes('json') ||
    obj.mime_type.includes('javascript') ||
    obj.mime_type.includes('xml') ||
    obj.key.endsWith('.md') ||
    obj.key.endsWith('.env');

  useEffect(() => {
    if (isText && textContent === null) {
      setLoadingText(true);
      fetch(previewSrc)
        .then((r) => r.text())
        .then((t) => setTextContent(t.slice(0, 50000))) // cap at 50KB for snappy preview
        .catch(() => setTextContent('(Failed to load preview text)'))
        .finally(() => setLoadingText(false));
    }
  }, [isText, previewSrc, textContent]);

  return (
    <div className="space-y-4 text-xs">
      {/* Visual Workspace Preview */}
      <div className="relative flex min-h-[220px] max-h-[380px] items-center justify-center overflow-hidden rounded-xl border border-[#232a35] bg-[#07090d] p-3">
        {isImage && (
          <div className="flex flex-col items-center justify-center overflow-auto w-full h-full">
            <img
              src={
                previewFormat === 'original'
                  ? previewSrc
                  : `${previewSrc}&format=${previewFormat}&w=800`
              }
              alt={obj.key}
              style={{ transform: `scale(${zoom / 100})`, transition: 'transform 0.15s ease-out' }}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNaturalDim({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              className="max-h-[320px] max-w-full rounded object-contain shadow-lg"
            />
          </div>
        )}

        {isVideo && (
          <video
            controls
            playsInline
            className="max-h-[320px] w-full rounded-lg shadow-lg"
            src={previewSrc}
          />
        )}

        {isAudio && (
          <div className="w-full max-w-md space-y-3 p-4 text-center">
            <Volume2 className="mx-auto h-12 w-12 text-[#84c498] animate-pulse" />
            <audio controls className="w-full" src={previewSrc} />
          </div>
        )}

        {isPDF && (
          <iframe
            title={obj.key}
            className="h-[340px] w-full rounded-lg border border-[#232a35] bg-white"
            src={previewSrc}
          />
        )}

        {isText && (
          <div className="h-[320px] w-full overflow-auto rounded bg-[#0b0e14] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
            {loadingText ? (
              <span className="text-slate-500">Loading document content...</span>
            ) : (
              <pre className="whitespace-pre-wrap">{textContent}</pre>
            )}
          </div>
        )}

        {!isImage && !isVideo && !isAudio && !isPDF && !isText && (
          <div className="py-12 text-center text-slate-500">
            <FileText className="mx-auto mb-2 h-10 w-10 text-slate-600" />
            <p>Binary object (No visual inline preview available).</p>
          </div>
        )}
      </div>

      {/* Interactive Image Controls (Zoom & Format Switcher) */}
      {isImage && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1e2633] bg-[#0c1017] px-3.5 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(50, z - 25))}
              className="rounded p-1 text-slate-400 hover:bg-[#1a222e] hover:text-white"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 text-center font-mono text-[11px] text-slate-300">{zoom}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(400, z + 25))}
              className="rounded p-1 text-slate-400 hover:bg-[#1a222e] hover:text-white"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              className="rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-[#1a222e] hover:text-white"
            >
              Reset
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-slate-400">On-the-fly Format:</span>
            {(['original', 'webp', 'jpeg'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setPreviewFormat(fmt)}
                className={`rounded px-2 py-0.5 uppercase transition ${
                  previewFormat === fmt
                    ? 'bg-[#417150] text-white font-bold'
                    : 'bg-[#151c26] text-slate-400 hover:text-slate-200'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Metadata Badges */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-[#232a35] bg-[#0b0d10] p-3 text-xs">
        <div>
          <dt className="text-slate-500">MIME Type</dt>
          <dd className="font-mono text-slate-200">{obj.mime_type}</dd>
        </div>
        <div>
          <dt className="text-slate-500">File Size</dt>
          <dd className="text-slate-200">{formatBytes(obj.size_bytes)}</dd>
        </div>
        {naturalDim && (
          <div>
            <dt className="text-slate-500">Dimensions</dt>
            <dd className="font-mono text-[#9bd3ad]">
              {naturalDim.w} × {naturalDim.h} px
            </dd>
          </div>
        )}
        <div className={naturalDim ? '' : 'col-span-2'}>
          <dt className="text-slate-500">Last Modified</dt>
          <dd className="text-slate-300">{new Date(obj.updated_at).toLocaleDateString()}</dd>
        </div>
      </dl>
    </div>
  );
}

