import xlsx from 'xlsx';

const PRODUCTS_SHEET_COLUMNS = [
  'Product Name',
  'SKU',
  'General SKU',
  'Description',
  'Category',
  'Width (in)',
  'Height (in)',
  'Depth (in)',
  'Style',
  'Color',
  'Door Type',
  'Glass Door',
  'Selling Price',
  'Purchase Price',
  'Currency',
  'Quantity',
  'Restock Lead Time (Days)',
  'Reorder Level',
  'Active',
];

export function getInventoryTemplateStatus() {
  return {
    available: true,
    fileName: 'InventoryProduct.xlsx',
    source: 'generated',
    columns: PRODUCTS_SHEET_COLUMNS,
    sheets: ['Instructions', 'Products', 'Examples', 'Reference Lists'],
  };
}

export function generateInventoryTemplateBuffer() {
  const workbook = xlsx.utils.book_new();
  const instructionRows = [
    ['Inventory Upload Instructions'],
    ['1. Populate only the Products sheet when preparing an import file.'],
    ['2. Keep the header row unchanged.'],
    ['3. SKU values must be unique within the workbook.'],
    ['4. Active and Glass Door accept only Yes or No.'],
    ['5. Width, Height, Depth, Selling Price, Purchase Price, Quantity, Restock Lead Time (Days), and Reorder Level must be numeric when provided.'],
  ];
  const productsExampleRow = [
    'Wall Cabinet 12 x 12 Glass Door',
    'W1212GD-SW',
    'W1212GD',
    'Shaker white wall cabinet with glass door',
    'Wall Cabinet',
    12,
    12,
    12,
    'Shaker',
    'Snow White',
    'Single Door',
    'Yes',
    149.99,
    102.5,
    'USD',
    25,
    10,
    5,
    'Yes',
  ];
  const examplesRows = [
    PRODUCTS_SHEET_COLUMNS,
    productsExampleRow,
    [
      'Base Cabinet 24 x 34.5',
      'B2434-ES',
      'B2434',
      'Espresso base cabinet',
      'Base Cabinet',
      24,
      34.5,
      24,
      'Slab',
      'Espresso',
      'Double Door',
      'No',
      219.0,
      151.75,
      'USD',
      12,
      14,
      3,
      'Yes',
    ],
  ];
  const referenceRows = [
    ['Field', 'Allowed / Example Values'],
    ['Glass Door', 'Yes, No'],
    ['Active', 'Yes, No'],
    ['Currency', 'USD, INR, CAD'],
    ['Door Type', 'Single Door, Double Door, Drawer Base, Open Shelf'],
    ['Category', 'Wall Cabinet, Base Cabinet, Pantry Cabinet, Vanity Cabinet'],
  ];
  const instructionsSheet = xlsx.utils.aoa_to_sheet(instructionRows);
  const productsSheet = xlsx.utils.aoa_to_sheet([PRODUCTS_SHEET_COLUMNS]);
  const examplesSheet = xlsx.utils.aoa_to_sheet(examplesRows);
  const referenceSheet = xlsx.utils.aoa_to_sheet(referenceRows);

  const standardColumns = [
    { wch: 28 },
    { wch: 18 },
    { wch: 18 },
    { wch: 40 },
    { wch: 20 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 24 },
    { wch: 14 },
    { wch: 12 },
  ];

  productsSheet['!cols'] = standardColumns;
  examplesSheet['!cols'] = standardColumns;
  instructionsSheet['!cols'] = [{ wch: 110 }];
  referenceSheet['!cols'] = [{ wch: 28 }, { wch: 42 }];

  xlsx.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
  xlsx.utils.book_append_sheet(workbook, productsSheet, 'Products');
  xlsx.utils.book_append_sheet(workbook, examplesSheet, 'Examples');
  xlsx.utils.book_append_sheet(workbook, referenceSheet, 'Reference Lists');

  return xlsx.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });
}
