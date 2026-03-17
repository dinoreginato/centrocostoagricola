
-- Update RUTs for known suppliers

UPDATE invoices SET supplier_rut = '93.847.000-8' WHERE supplier ILIKE '%TATTERSALL%';
UPDATE invoices SET supplier_rut = '96.536.880-8' WHERE supplier ILIKE 'COPEVAL';
UPDATE invoices SET supplier_rut = '99.520.000-7' WHERE supplier ILIKE 'COPEC';
UPDATE invoices SET supplier_rut = '76.411.321-7' WHERE supplier ILIKE 'CGE';
UPDATE invoices SET supplier_rut = '96.516.320-3' WHERE supplier ILIKE 'COAGRA';
UPDATE invoices SET supplier_rut = '96.650.620-1' WHERE supplier ILIKE 'FRUSAN';
UPDATE invoices SET supplier_rut = '97.004.000-5' WHERE supplier ILIKE 'BANCO DE CHILE';
UPDATE invoices SET supplier_rut = '96.918.720-3' WHERE supplier ILIKE 'AUTOPISTA CENTRAL';
UPDATE invoices SET supplier_rut = '96.929.560-K' WHERE supplier ILIKE 'COSTANERA NORTE';
UPDATE invoices SET supplier_rut = '96.945.540-2' WHERE supplier ILIKE 'VESPUCIO SUR';
UPDATE invoices SET supplier_rut = '96.958.820-8' WHERE supplier ILIKE 'VESPUCIO NORTE';
UPDATE invoices SET supplier_rut = '96.806.980-2' WHERE supplier ILIKE 'ENTEL PCS';
UPDATE invoices SET supplier_rut = '90.160.000-6' WHERE supplier ILIKE 'CHUBB SEGURO CHILE';
UPDATE invoices SET supplier_rut = '99.537.000-K' WHERE supplier ILIKE 'HDI SEGUROS';
UPDATE invoices SET supplier_rut = '93.364.000-2' WHERE supplier ILIKE 'MARTINEZ Y VALDIVIESO SA';
UPDATE invoices SET supplier_rut = '96.634.690-5' WHERE supplier ILIKE 'IRENESA';
UPDATE invoices SET supplier_rut = '77.085.390-3' WHERE supplier ILIKE '%GENESIS LIMITADA%' OR supplier ILIKE '%GENESIS LTDA%';
UPDATE invoices SET supplier_rut = '76.012.836-8' WHERE supplier ILIKE 'COMERCIAL RENGO LUBRICANTES%';
