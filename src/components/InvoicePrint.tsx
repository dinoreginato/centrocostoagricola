import React from 'react';
import { formatCLP } from '../lib/utils';
import { Building2 } from 'lucide-react';

interface InvoicePrintProps {
  invoice: any;
  company: any;
  items: any[];
}

export const InvoicePrint: React.FC<InvoicePrintProps> = ({ invoice, company, items }) => {
  // Calculate totals if not provided in invoice object
  const subtotal = items.reduce((sum, item) => sum + (item.total_price || 0), 0);
  const discount = invoice.discount_amount || 0;
  const net = subtotal - discount;
  const tax = invoice.tax_percentage ? net * (invoice.tax_percentage / 100) : 0;
  const exempt = invoice.exempt_amount || 0;
  const specialTax = invoice.special_tax_amount || 0;
  const total = net + tax + exempt + specialTax;

  return (
    <div className="bg-white p-8 max-w-4xl mx-auto text-black print:p-0 print:max-w-none print:mx-0 font-sans text-sm">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        {/* Left: Company Logo/Info */}
        <div className="w-1/2 pr-8">
          <div className="flex items-center mb-4">
             {/* Placeholder for Logo */}
             <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mr-4 print:border print:border-gray-300">
                <Building2 className="w-8 h-8 text-gray-400" />
             </div>
             <div>
                <h1 className="text-xl font-bold uppercase text-red-700">{company?.name || 'EMPRESA AGRÍCOLA'}</h1>
                <p className="font-bold">GIRO: AGRICULTURA Y FRUTICULTURA</p>
                <p>CASA MATRIZ: DIRECCIÓN EMPRESA, CIUDAD</p>
                <p>FONO: +56 9 1234 5678</p>
                <p>EMAIL: contacto@empresa.cl</p>
             </div>
          </div>
        </div>

        {/* Right: RUT Box (Standard Chilean Format) */}
        <div className="w-1/3 border-4 border-red-600 p-4 text-center font-bold text-red-600">
          <h2 className="text-xl mb-1">R.U.T.: {company?.rut || '76.XXX.XXX-X'}</h2>
          <h2 className="text-lg mb-1 uppercase">{invoice.document_type || 'FACTURA ELECTRONICA'}</h2>
          <h2 className="text-xl">N° {invoice.invoice_number}</h2>
        </div>
      </div>

      {/* Client / Recipient Info */}
      <div className="border border-gray-800 p-2 mb-6 text-xs">
         <div className="grid grid-cols-12 gap-2 mb-1">
            <div className="col-span-2 font-bold">SEÑOR(ES):</div>
            <div className="col-span-6 uppercase">{invoice.supplier}</div>
            <div className="col-span-1 font-bold">FECHA:</div>
            <div className="col-span-3">{new Date(invoice.invoice_date).toLocaleDateString('es-CL')}</div>
         </div>
         <div className="grid grid-cols-12 gap-2 mb-1">
            <div className="col-span-2 font-bold">R.U.T.:</div>
            <div className="col-span-6">UNKNOWN-K (Proveedor)</div>
            <div className="col-span-1 font-bold">VENCE:</div>
            <div className="col-span-3">{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('es-CL') : '-'}</div>
         </div>
         <div className="grid grid-cols-12 gap-2 mb-1">
            <div className="col-span-2 font-bold">GIRO:</div>
            <div className="col-span-6">PROVEEDOR AGRÍCOLA</div>
            <div className="col-span-1 font-bold">FONO:</div>
            <div className="col-span-3">-</div>
         </div>
         <div className="grid grid-cols-12 gap-2">
            <div className="col-span-2 font-bold">DIRECCIÓN:</div>
            <div className="col-span-6">DIRECCIÓN PROVEEDOR, COMUNA</div>
            <div className="col-span-1 font-bold">COMUNA:</div>
            <div className="col-span-3">SANTIAGO</div>
         </div>
      </div>

      {/* Items Table */}
      <div className="mb-6">
        <table className="w-full border-collapse border border-gray-800 text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-800 p-1 text-center w-16">CANTIDAD</th>
              <th className="border border-gray-800 p-1 text-center w-16">UNIDAD</th>
              <th className="border border-gray-800 p-1 text-left">DESCRIPCIÓN</th>
              <th className="border border-gray-800 p-1 text-right w-24">P. UNITARIO</th>
              <th className="border border-gray-800 p-1 text-right w-24">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx}>
                <td className="border border-gray-800 p-1 text-center">{item.quantity}</td>
                <td className="border border-gray-800 p-1 text-center">{item.unit || item.products?.unit || 'un'}</td>
                <td className="border border-gray-800 p-1 text-left uppercase">
                    {item.product_name || item.products?.name || 'Sin descripción'}
                    {(item.active_ingredient || item.products?.active_ingredient) && (
                        <div className="text-[10px] italic">({item.active_ingredient || item.products?.active_ingredient})</div>
                    )}
                </td>
                <td className="border border-gray-800 p-1 text-right">{formatCLP(item.unit_price)}</td>
                <td className="border border-gray-800 p-1 text-right">{formatCLP(item.total_price)}</td>
              </tr>
            ))}
            {/* Fill empty rows to maintain height if needed, or just let it collapse */}
             {items.length < 5 && Array.from({ length: 5 - items.length }).map((_, idx) => (
                <tr key={`empty-${idx}`}>
                    <td className="border border-gray-800 p-1 text-center">&nbsp;</td>
                    <td className="border border-gray-800 p-1 text-center">&nbsp;</td>
                    <td className="border border-gray-800 p-1 text-left">&nbsp;</td>
                    <td className="border border-gray-800 p-1 text-right">&nbsp;</td>
                    <td className="border border-gray-800 p-1 text-right">&nbsp;</td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals & Footer */}
      <div className="flex border border-gray-800 text-xs h-32">
          {/* Left: Timbre & Notes */}
          <div className="w-2/3 p-2 border-r border-gray-800 flex flex-col justify-between">
              <div>
                  <div className="font-bold mb-1">OBSERVACIONES:</div>
                  <div className="italic text-gray-600 mb-2">{invoice.notes || 'Sin observaciones'}</div>
              </div>
              
              {/* Fake Timbre SII */}
              <div className="border border-red-600 text-red-600 p-2 text-center w-48 mx-auto text-[10px]">
                  <div className="font-bold">TIMBRE ELECTRÓNICO SII</div>
                  <div>RES. 80 de 2014</div>
                  <div className="my-1 border-t border-b border-red-600 py-1">QR CODE PLACEHOLDER</div>
                  <div>Verifique documento: www.sii.cl</div>
              </div>
          </div>

          {/* Right: Totals */}
          <div className="w-1/3">
              <div className="flex justify-between p-1 border-b border-gray-800">
                  <span className="font-bold">MONTO NETO:</span>
                  <span>{formatCLP(net)}</span>
              </div>
              <div className="flex justify-between p-1 border-b border-gray-800">
                  <span className="font-bold">DESCUENTO:</span>
                  <span>{formatCLP(discount)}</span>
              </div>
              {exempt > 0 && (
                  <div className="flex justify-between p-1 border-b border-gray-800">
                      <span className="font-bold">MONTO EXENTO:</span>
                      <span>{formatCLP(exempt)}</span>
                  </div>
              )}
              <div className="flex justify-between p-1 border-b border-gray-800">
                  <span className="font-bold">I.V.A. (19%):</span>
                  <span>{formatCLP(tax)}</span>
              </div>
              {specialTax > 0 && (
                  <div className="flex justify-between p-1 border-b border-gray-800">
                      <span className="font-bold">IMP. ESPECIAL:</span>
                      <span>{formatCLP(specialTax)}</span>
                  </div>
              )}
              <div className="flex justify-between p-2 font-bold text-sm bg-gray-100">
                  <span>TOTAL:</span>
                  <span>{formatCLP(total)}</span>
              </div>
          </div>
      </div>
      
      <div className="mt-4 text-[10px] text-right text-gray-500">
          "El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4, y la letra c) del Art. 5 de la Ley 19.983, acredita que la entrega de mercaderías o servicio(s) prestado(s) ha(n) sido recibido(s)."
      </div>
      
      <div className="mt-8 flex justify-between text-xs print:hidden">
         <div className="border-t border-black w-1/3 text-center pt-1">
             NOMBRE: _______________________
         </div>
         <div className="border-t border-black w-1/3 text-center pt-1">
             R.U.T.: _______________________
         </div>
         <div className="border-t border-black w-1/3 text-center pt-1">
             FIRMA: _______________________
         </div>
      </div>

    </div>
  );
};
