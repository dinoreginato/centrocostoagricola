import { toast } from 'sonner';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCompany } from '../contexts/CompanyContext';
import { useAuth } from '../contexts/AuthContext';
import { formatCLP } from '../lib/utils';
import { parseAssistantIntent } from '../lib/assistantNlp';
import { generateFieldCostsReport, type FieldCostsReport } from '../services/assistantReports';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Loader2, MessageSquare, FileDown, Send, Phone, ThumbsUp, ThumbsDown } from 'lucide-react';
import { PdfPreviewModal } from '../components/PdfPreviewModal';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  userText?: string;
  attachment?:
    | {
        kind: 'invoices_due';
        title: string;
        month: number;
        year: number;
        status: string;
        range: { from: string; to: string };
        invoices: Array<{
          id: string;
          invoice_number: string | null;
          supplier: string | null;
          invoice_date: string | null;
          due_date: string | null;
          total_amount: number | null;
          status: string | null;
          document_type: string | null;
        }>;
      }
    | {
        kind: 'application_last';
        title: string;
        application: {
          id: string;
          application_date: string | null;
          application_type: string | null;
          total_cost: number | null;
          water_liters_per_hectare: number | null;
          field_id: string | null;
          field_name: string | null;
          sector_id: string | null;
          sector_name: string | null;
          sector_hectares: number | null;
          items: Array<{
            product_id: string | null;
            product_name: string | null;
            quantity_used: number | null;
            dose_per_hectare: number | null;
            unit: string | null;
            unit_cost: number | null;
            total_cost: number | null;
          }>;
        };
      };
  createdAt: number;
};

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function filterLabel(filter: FieldCostsReport['filter']) {
  if (filter.kind === 'all') return 'Todo el período';
  if (filter.kind === 'season') return `Temporada ${filter.season}`;
  return `${filter.from} a ${filter.to}`;
}

export const Assistant: React.FC = () => {
  const { selectedCompany } = useCompany();
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<FieldCostsReport | null>(null);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappTo, setWhatsappTo] = useState('');
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [feedbackOpenFor, setFeedbackOpenFor] = useState<string | null>(null);
  const [feedbackCorrection, setFeedbackCorrection] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const canRun = Boolean(selectedCompany);

  const quickHelp = useMemo(
    () => [
      'Costos por campo temporada 2025-2026',
      'Costos por campo marzo 2026'
    ],
    []
  );

  const appendMessage = React.useCallback((msg: Omit<ChatMessage, 'id' | 'createdAt'>) => {
    setMessages((prev) => [...prev, { id: uid(), createdAt: Date.now(), ...msg }]);
  }, []);

  const callAi = React.useCallback(
    async (text: string, userTextForAnswer: string) => {
      if (!selectedCompany) return;
      if (!session?.access_token) {
        appendMessage({ role: 'assistant', text: 'Para usar IA, inicia sesión nuevamente.' });
        return;
      }

      const history = [...messages, { id: uid(), createdAt: Date.now(), role: 'user' as const, text }].slice(-20);
      const payload = {
        companyId: selectedCompany.id,
        messages: history.map((m) => ({ role: m.role, content: m.text }))
      };

      const resp = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail || data?.error || 'No se pudo obtener respuesta');
      const answer = String(data?.answer || '').trim();
      const attachment = data?.attachment && typeof data.attachment === 'object' ? data.attachment : undefined;
      appendMessage({
        role: 'assistant',
        text: answer || 'No pude generar una respuesta.',
        userText: userTextForAnswer,
        attachment
      });

      if (Array.isArray(data?.warnings) && data.warnings.length > 0) {
        toast.warning(String(data.warnings[0]));
      }
    },
    [appendMessage, messages, selectedCompany, session?.access_token]
  );

  const runAssistant = React.useCallback(async (text: string) => {
    if (!selectedCompany) return;
    const intent = parseAssistantIntent(text);

    appendMessage({ role: 'user', text });
    setLoading(true);
    try {
      if (intent.kind === 'field_costs' || intent.kind === 'cost_category') {
        const filter =
          intent.from && intent.to
            ? ({ kind: 'range', from: intent.from, to: intent.to } as const)
            : intent.season
              ? ({ kind: 'season', season: intent.season } as const)
              : ({ kind: 'all' } as const);

        const title = `Costos por Campo - ${selectedCompany.name} - ${filterLabel(filter)}`;
        const rep = await generateFieldCostsReport({ companyId: selectedCompany.id, filter, title });
        setReport(rep);

        if (intent.kind === 'field_costs') {
          appendMessage({
            role: 'assistant',
            text: `Listo. Generé el reporte “Costos por campo” (${filterLabel(filter)}). Total: ${formatCLP(rep.total_cost)}.`,
            userText: text
          });
          return;
        }

        const sum = rep.fields.reduce((acc, r) => {
          const b = r.breakdown as any;
          if (intent.category === 'fuel') return acc + Number(b.fuel_diesel || 0) + Number(b.fuel_gasoline || 0);
          return acc + Number(b[intent.category] || 0);
        }, 0);

        const label =
          intent.category === 'irrigation'
            ? 'Riego'
            : intent.category === 'labor'
              ? 'Labores'
              : intent.category === 'workers'
                ? 'Trabajadores'
                : intent.category === 'machinery'
                  ? 'Maquinaria'
                  : intent.category === 'applications'
                    ? 'Aplicaciones'
                    : intent.category === 'distribution'
                      ? 'Distribución'
                      : intent.category === 'fuel_diesel'
                        ? 'Petróleo'
                        : intent.category === 'fuel_gasoline'
                          ? 'Bencina'
                          : 'Combustible';

        appendMessage({
          role: 'assistant',
          text: `En ${filterLabel(filter)}, el gasto total de ${label} es ${formatCLP(sum)}.`,
          userText: text
        });
        return;
      }

      await callAi(text, text);
    } catch (e: any) {
      const detail = String(e?.message || e || '').trim();
      toast.error(detail || 'Error al responder');
      appendMessage({
        role: 'assistant',
        text: detail ? `No pude responder: ${detail}` : 'No pude obtener una respuesta con los datos.',
        userText: text
      });
    } finally {
      setLoading(false);
    }
  }, [appendMessage, callAi, selectedCompany]);

  const sendFeedback = async (opts: { messageId: string; rating: 1 | -1; correction?: string }) => {
    if (!selectedCompany) return;
    if (!session?.access_token) return;
    const msg = messages.find((m) => m.id === opts.messageId);
    if (!msg || msg.role !== 'assistant') return;

    const userMessage = String(msg.userText || '').trim();
    if (!userMessage) return;

    setSendingFeedback(true);
    try {
      const resp = await fetch('/api/assistant/feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          userMessage,
          assistantMessage: msg.text,
          rating: opts.rating,
          correction: opts.correction || ''
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail || data?.error || 'No se pudo guardar feedback');
      toast.success('Gracias, guardé tu feedback.');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSendingFeedback(false);
    }
  };

  useEffect(() => {
    const q = searchParams.get('q');
    if (!q || !selectedCompany) return;
    setSearchParams({});
    void runAssistant(q);
  }, [runAssistant, searchParams, selectedCompany, setSearchParams]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/status')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setWhatsappEnabled(Boolean(data?.enabled));
      })
      .catch(() => {
        if (cancelled) return;
        setWhatsappEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const downloadExcel = async () => {
    if (!report || !selectedCompany) return;
    const blob = await buildExcelBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Costos_por_Campo_${selectedCompany.name.replace(/\s+/g, '_')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildExcelBlob = async () => {
    if (!report || !selectedCompany) return null;
    const ExcelJSImport = (await import('exceljs/dist/exceljs.bare.min.js')).default as unknown as any;
    const ExcelJS = ExcelJSImport as unknown as { Workbook: new () => any };
    const wb = new ExcelJS.Workbook();

    const rowsFields = report.fields.map((r) => ({
      Campo: r.field_name,
      Hectareas: Number(r.hectares) || 0,
      Total: Number(r.total_cost) || 0,
      'Costo/ha': Number(r.cost_per_ha) || 0,
      Aplicaciones: r.breakdown.applications,
      Labores: r.breakdown.labor,
      Trabajadores: r.breakdown.workers,
      Petróleo: r.breakdown.fuel_diesel,
      Bencina: r.breakdown.fuel_gasoline,
      Maquinaria: r.breakdown.machinery,
      Riego: r.breakdown.irrigation,
      Distribución: r.breakdown.distribution
    }));

    const rowsSectors = report.sectors.map((r) => ({
      Campo: r.field_name,
      Sector: r.sector_name,
      Hectareas: Number(r.hectares) || 0,
      Total: Number(r.total_cost) || 0,
      Aplicaciones: r.breakdown.applications,
      Labores: r.breakdown.labor,
      Trabajadores: r.breakdown.workers,
      Petróleo: r.breakdown.fuel_diesel,
      Bencina: r.breakdown.fuel_gasoline,
      Maquinaria: r.breakdown.machinery,
      Riego: r.breakdown.irrigation,
      Distribución: r.breakdown.distribution
    }));

    const addSheet = (name: string, rows: Array<Record<string, unknown>>) => {
      const ws = wb.addWorksheet(String(name).slice(0, 31) || 'Hoja');
      const keySet = new Set<string>();
      rows.forEach((r) => Object.keys(r || {}).forEach((k) => keySet.add(k)));
      const keys = Array.from(keySet);
      ws.columns = keys.map((k) => ({
        header: k,
        key: k,
        width: Math.min(Math.max(k.length + 2, 12), 40)
      }));
      rows.forEach((r) => ws.addRow(r || {}));
    };

    addSheet('Resumen_Campos', rowsFields);
    addSheet('Detalle_Sectores', rowsSectors);

    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };

  const buildPdf = () => {
    if (!report || !selectedCompany) return null;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(report.title, 40, 40);
    doc.setFontSize(10);
    doc.text(`Total: ${formatCLP(report.total_cost)}`, 40, 58);

    const body = report.fields.map((r) => [
      r.field_name,
      (Number(r.hectares) || 0).toFixed(2),
      formatCLP(r.total_cost),
      formatCLP(r.cost_per_ha),
      formatCLP(r.breakdown.applications),
      formatCLP(r.breakdown.labor),
      formatCLP(r.breakdown.workers),
      formatCLP(r.breakdown.fuel_diesel),
      formatCLP(r.breakdown.fuel_gasoline),
      formatCLP(r.breakdown.machinery),
      formatCLP(r.breakdown.irrigation),
      formatCLP(r.breakdown.distribution)
    ]);

    autoTable(doc, {
      startY: 75,
      head: [
        [
          'Campo',
          'Ha',
          'Total',
          'Costo/ha',
          'Aplicaciones',
          'Labores',
          'Trabajadores',
          'Petróleo',
          'Bencina',
          'Maquinaria',
          'Riego',
          'Distribución'
        ]
      ],
      body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [34, 197, 94] },
      columnStyles: {
        0: { cellWidth: 160 },
        1: { cellWidth: 45, halign: 'right' },
        2: { cellWidth: 70, halign: 'right' },
        3: { cellWidth: 70, halign: 'right' }
      }
    });

    return doc;
  };

  type InvoicesDueAttachment = Extract<NonNullable<ChatMessage['attachment']>, { kind: 'invoices_due' }>;
  type ApplicationLastAttachment = Extract<NonNullable<ChatMessage['attachment']>, { kind: 'application_last' }>;

  const buildInvoicesDuePdf = (attachment: InvoicesDueAttachment) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(attachment.title, 40, 40);
    doc.setFontSize(10);
    doc.text(`Período: ${attachment.range.from} a ${attachment.range.to}`, 40, 58);

    const body = (attachment.invoices || []).map((inv) => [
      String(inv.due_date || ''),
      String(inv.supplier || ''),
      String(inv.invoice_number || ''),
      formatCLP(Number(inv.total_amount) || 0),
      String(inv.status || '')
    ]);

    autoTable(doc, {
      startY: 75,
      head: [['Vence', 'Proveedor', 'N°', 'Monto', 'Estado']],
      body,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [34, 197, 94] },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 220 },
        2: { cellWidth: 90 },
        3: { cellWidth: 80, halign: 'right' },
        4: { cellWidth: 70 }
      }
    });

    return doc;
  };

  const buildLastApplicationPdf = (attachment: ApplicationLastAttachment) => {
    const app = attachment.application;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(attachment.title, 40, 40);
    doc.setFontSize(10);
    doc.text(`Fecha: ${String(app.application_date || '')}`, 40, 58);
    doc.text(`Campo: ${String(app.field_name || '')}`, 40, 72);
    doc.text(`Sector: ${String(app.sector_name || '')}`, 40, 86);
    doc.text(`Tipo: ${String(app.application_type || '')}`, 40, 100);
    doc.text(`Costo total: ${formatCLP(Number(app.total_cost) || 0)}`, 40, 114);
    if (Number(app.water_liters_per_hectare)) {
      doc.text(`Agua (L/ha): ${Number(app.water_liters_per_hectare)}`, 40, 128);
    }

    const body = (app.items || []).map((it) => [
      String(it.product_name || ''),
      String(Number(it.quantity_used) || 0),
      String(it.unit || ''),
      formatCLP(Number(it.total_cost) || 0)
    ]);

    autoTable(doc, {
      startY: 150,
      head: [['Producto', 'Cantidad', 'Unidad', 'Costo']],
      body,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [34, 197, 94] },
      columnStyles: {
        0: { cellWidth: 240 },
        1: { cellWidth: 70, halign: 'right' },
        2: { cellWidth: 70 },
        3: { cellWidth: 80, halign: 'right' }
      }
    });

    return doc;
  };

  const buildInvoicesDueExcelBlob = async (attachment: InvoicesDueAttachment) => {
    const ExcelJSImport = (await import('exceljs/dist/exceljs.bare.min.js')).default as unknown as any;
    const ExcelJS = ExcelJSImport as unknown as { Workbook: new () => any };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Facturas');
    ws.columns = [
      { header: 'Vence', key: 'due_date', width: 12 },
      { header: 'Proveedor', key: 'supplier', width: 32 },
      { header: 'N°', key: 'invoice_number', width: 14 },
      { header: 'Monto', key: 'total_amount', width: 14 },
      { header: 'Estado', key: 'status', width: 14 }
    ];
    (attachment.invoices || []).forEach((inv) =>
      ws.addRow({
        due_date: inv.due_date || '',
        supplier: inv.supplier || '',
        invoice_number: inv.invoice_number || '',
        total_amount: Number(inv.total_amount) || 0,
        status: inv.status || ''
      })
    );
    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };

  const previewInvoicesPdf = (attachment: InvoicesDueAttachment) => {
    const doc = buildInvoicesDuePdf(attachment);
    const url = String(doc.output('bloburl'));
    setPdfPreviewTitle(attachment.title);
    setPdfPreviewUrl(url);
    setPdfPreviewOpen(true);
  };

  const previewLastApplicationPdf = (attachment: ApplicationLastAttachment) => {
    const doc = buildLastApplicationPdf(attachment);
    const url = String(doc.output('bloburl'));
    setPdfPreviewTitle(attachment.title);
    setPdfPreviewUrl(url);
    setPdfPreviewOpen(true);
  };

  const downloadInvoicesPdf = (attachment: InvoicesDueAttachment) => {
    const doc = buildInvoicesDuePdf(attachment);
    doc.save(`Facturas_por_Vencer_${attachment.year}_${String(attachment.month).padStart(2, '0')}.pdf`);
  };

  const downloadLastApplicationPdf = (attachment: ApplicationLastAttachment) => {
    const doc = buildLastApplicationPdf(attachment);
    doc.save(`Ultima_Aplicacion_${String(attachment.application.field_name || 'campo').replace(/\s+/g, '_')}.pdf`);
  };

  const downloadInvoicesExcel = async (attachment: InvoicesDueAttachment) => {
    const blob = await buildInvoicesDueExcelBlob(attachment);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Facturas_por_Vencer_${attachment.year}_${String(attachment.month).padStart(2, '0')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const previewPdf = () => {
    const doc = buildPdf();
    if (!doc) return;
    const url = String(doc.output('bloburl'));
    setPdfPreviewTitle(report?.title || 'Reporte');
    setPdfPreviewUrl(url);
    setPdfPreviewOpen(true);
  };

  const downloadPdf = () => {
    const doc = buildPdf();
    if (!doc || !selectedCompany) return;
    doc.save(`Costos_por_Campo_${selectedCompany.name.replace(/\s+/g, '_')}.pdf`);
  };

  const sendWhatsapp = async () => {
    if (!report) return;
    const to = whatsappTo.trim();
    if (!to) return;

    try {
      const base = window.location.origin;
      const link = `${base}/asistente?q=${encodeURIComponent('Costos por campo ' + filterLabel(report.filter))}`;
      const text = `Reporte listo: ${report.title}\nTotal: ${formatCLP(report.total_cost)}\nAbrir en AgroCostos: ${link}`;
      const resp = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, text })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'No se pudo enviar WhatsApp');
      toast.success('Mensaje enviado por WhatsApp');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const idx = raw.indexOf('base64,');
        if (idx === -1) resolve('');
        else resolve(raw.slice(idx + 7));
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(blob);
    });

  const sendWhatsappFile = async (opts: { filename: string; mime: string; blob: Blob }) => {
    if (!report) return;
    const to = whatsappTo.trim();
    if (!to) return;

    setSendingWhatsapp(true);
    try {
      const dataBase64 = await blobToBase64(opts.blob);
      if (!dataBase64) throw new Error('Archivo inválido');
      const resp = await fetch('/api/whatsapp/send-media', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to,
          filename: opts.filename,
          mime: opts.mime,
          dataBase64,
          caption: report.title
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'No se pudo enviar archivo');
      toast.success('Archivo enviado por WhatsApp');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSendingWhatsapp(false);
    }
  };

  const sendWhatsappPdf = async () => {
    if (!report || !selectedCompany) return;
    const doc = buildPdf();
    if (!doc) return;
    const blob = doc.output('blob') as unknown as Blob;
    await sendWhatsappFile({
      filename: `Costos_por_Campo_${selectedCompany.name.replace(/\s+/g, '_')}.pdf`,
      mime: 'application/pdf',
      blob
    });
  };

  const sendWhatsappExcel = async () => {
    if (!report || !selectedCompany) return;
    const blob = await buildExcelBlob();
    if (!blob) return;
    await sendWhatsappFile({
      filename: `Costos_por_Campo_${selectedCompany.name.replace(/\s+/g, '_')}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      blob
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    void runAssistant(text);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <MessageSquare className="h-6 w-6 text-green-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Asistente</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">Pide reportes con lenguaje natural y descárgalos en PDF y Excel.</p>
        </div>
      </div>

      {!canRun && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Selecciona una empresa para usar el asistente.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ejemplos rápidos</div>
            <div className="mt-3 space-y-2">
              {quickHelp.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void runAssistant(q)}
                  disabled={!canRun || loading}
                  className="w-full text-left text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4">
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ej: Costos por campo temporada 2025-2026"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                disabled={!canRun || loading}
              />
              <button
                type="submit"
                disabled={!canRun || loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </button>
            </form>

            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              Descarga reportes en PDF/Excel desde esta pantalla.
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Conversación</div>
              {loading && (
                <div className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generando…
                </div>
              )}
            </div>
            <div ref={listRef} className="max-h-[380px] overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Escribe una solicitud para empezar.</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="space-y-2">
                    <div className={`text-sm ${m.role === 'user' ? 'text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'}`}>
                      <span className="font-semibold">{m.role === 'user' ? 'Tú: ' : 'Asistente: '}</span>
                      {m.text}
                    </div>
                    {m.role === 'assistant' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={sendingFeedback}
                          onClick={() => void sendFeedback({ messageId: m.id, rating: 1 })}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                          Útil
                        </button>
                        <button
                          type="button"
                          disabled={sendingFeedback}
                          onClick={() => {
                            setFeedbackOpenFor(m.id);
                            setFeedbackCorrection('');
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                          Corregir
                        </button>
                        {m.attachment?.kind === 'invoices_due' && (
                          <>
                            <button
                              type="button"
                              onClick={() => previewInvoicesPdf(m.attachment as InvoicesDueAttachment)}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              Ver PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadInvoicesPdf(m.attachment as InvoicesDueAttachment)}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => void downloadInvoicesExcel(m.attachment as InvoicesDueAttachment)}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              Excel
                            </button>
                          </>
                        )}
                        {m.attachment?.kind === 'application_last' && (
                          <>
                            <button
                              type="button"
                              onClick={() => previewLastApplicationPdf(m.attachment as ApplicationLastAttachment)}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              Ver PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadLastApplicationPdf(m.attachment as ApplicationLastAttachment)}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              PDF
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {m.role === 'assistant' && feedbackOpenFor === m.id && (
                      <div className="flex gap-2">
                        <input
                          value={feedbackCorrection}
                          onChange={(e) => setFeedbackCorrection(e.target.value)}
                          placeholder="¿Qué debería haber respondido?"
                          className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                        />
                        <button
                          type="button"
                          disabled={sendingFeedback}
                          onClick={() => {
                            void sendFeedback({ messageId: m.id, rating: -1, correction: feedbackCorrection });
                            setFeedbackOpenFor(null);
                            setFeedbackCorrection('');
                          }}
                          className="inline-flex items-center justify-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          Guardar
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {report && (
            <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{report.title}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">Total: {formatCLP(report.total_cost)}</div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={downloadExcel}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <FileDown className="h-4 w-4" />
                    Excel
                  </button>
                  <button
                    type="button"
                    onClick={previewPdf}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    <FileDown className="h-4 w-4" />
                    Ver PDF
                  </button>
                  <button
                    type="button"
                    onClick={downloadPdf}
                    className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    <FileDown className="h-4 w-4" />
                    PDF
                  </button>
                </div>
              </div>

              <div className="p-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200">Resumen por Campo</div>
                    <div className="max-h-[320px] overflow-y-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
                          <tr>
                            <th className="px-3 py-2 text-left">Campo</th>
                            <th className="px-3 py-2 text-right">Ha</th>
                            <th className="px-3 py-2 text-right">Total</th>
                            <th className="px-3 py-2 text-right">Costo/ha</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {report.fields.map((r) => (
                            <tr key={r.field_id} className="text-gray-700 dark:text-gray-200">
                              <td className="px-3 py-2">{r.field_name}</td>
                              <td className="px-3 py-2 text-right">{(Number(r.hectares) || 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right">{formatCLP(r.total_cost)}</td>
                              <td className="px-3 py-2 text-right">{formatCLP(r.cost_per_ha)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {whatsappEnabled && (
                    <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <div className="px-3 py-2 text-xs font-semibold bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200">Enviar por WhatsApp</div>
                      <div className="p-3 space-y-2">
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Phone className="h-4 w-4 text-gray-400 absolute left-3 top-2.5" />
                            <input
                              value={whatsappTo}
                              onChange={(e) => setWhatsappTo(e.target.value)}
                              placeholder="Ej: 56912345678"
                              className="w-full pl-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={sendWhatsapp}
                            className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"
                          >
                            Enviar
                          </button>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="button"
                            disabled={sendingWhatsapp}
                            onClick={sendWhatsappPdf}
                            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            <FileDown className="h-4 w-4" />
                            WhatsApp PDF
                          </button>
                          <button
                            type="button"
                            disabled={sendingWhatsapp}
                            onClick={() => void sendWhatsappExcel()}
                            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <FileDown className="h-4 w-4" />
                            WhatsApp Excel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <PdfPreviewModal
        isOpen={pdfPreviewOpen}
        onClose={() => {
          setPdfPreviewOpen(false);
          if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
          setPdfPreviewUrl(null);
        }}
        pdfUrl={pdfPreviewUrl}
        title={pdfPreviewTitle}
      />
    </div>
  );
};

export default Assistant;
