import React from 'react';
import { X, Download, Printer } from 'lucide-react';

interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  pdfUrl: string | null;
}

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({ isOpen, onClose, title, pdfUrl }) => {
  if (!isOpen || !pdfUrl) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          <div className="flex items-center space-x-2">
            <a 
              href={pdfUrl} 
              download={`${title.replace(/\s+/g, '_')}.pdf`}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
              title="Descargar"
            >
              <Download className="h-5 w-5" />
            </a>
            <button 
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
              title="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        {/* Content - Iframe for PDF */}
        <div className="flex-1 bg-gray-100 p-0 overflow-hidden relative">
            <iframe 
                src={pdfUrl} 
                className="w-full h-full border-0"
                title="PDF Preview"
            />
        </div>
        
        {/* Footer (Optional) */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
            <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
                Cerrar
            </button>
        </div>
      </div>
    </div>
  );
};
