export type SalesOrderSummary = {
  salesorder_id: string;
  salesorder_number: string;
  customer_name: string;
  status: string;
  date?: string;
  total?: number;
};

export type ZohoCustomField = {
  api_name?: string;
  placeholder?: string;
  label?: string;
  value?: string | number | boolean | null;
  value_formatted?: string;
};

export type SalesOrderLineItem = {
  line_item_id?: string;
  item_id?: string;
  composite_item_id?: string;
  item_name?: string;
  name?: string;
  sku?: string;
  description?: string;
  quantity?: number;
  rate?: number;
  unit?: string;
  group_name?: string;
  is_combo_product?: boolean;
  item_type?: string;
  product_type?: string;
  stock_on_hand?: number;
  quantity_available?: number;
  actual_available_stock?: number;
  cf_group?: string;
  custom_field_hash?: Record<string, string | number | boolean | null>;
  custom_fields?: ZohoCustomField[];
  item_total?: number;
};

export type SalesOrderDetail = SalesOrderSummary & {
  customer_id?: string;
  email?: string;
  reference_number?: string;
  salesperson_name?: string;
  billing_address?: Record<string, string | number | boolean | null | undefined>;
  shipping_address?: Record<string, string | number | boolean | null | undefined>;
  contact_person_details?: Array<Record<string, string | number | boolean | null | undefined>>;
  line_items?: SalesOrderLineItem[];
};

export type ItemDetail = {
  item_id: string;
  name?: string;
  item_name?: string;
  sku?: string;
  available_stock?: number;
  stock_on_hand?: number;
  actual_available_stock?: number;
  group_name?: string;
  category_name?: string;
  unit?: string;
  is_combo_product?: boolean | string;
  combo_type?: string;
  item_type?: string;
  product_type?: string;
  composite_item_id?: string;
  cf_group?: string;
  cf_sub_group?: string;
  cf_height?: string | number;
  cf_width?: string | number;
  cf_depth?: string | number;
  cf_thickness?: string | number;
  cf_finish?: string;
  cf_type?: string;
  cf_waste_percentage?: string | number;
  custom_field_hash?: Record<string, string | number | boolean | null>;
  custom_fields?: ZohoCustomField[];
};

export type CompositeMappedItem = {
  mapped_item_id?: string;
  item_id: string;
  composite_item_id?: string;
  item_order?: number;
  name?: string;
  item_name?: string;
  sku?: string;
  quantity?: number;
  quantity_needed?: number;
  unit?: string;
  unit_name?: string;
  available_stock?: number;
  stock_on_hand?: number;
  actual_available_stock?: number;
  quantity_available?: number;
  is_combo_product?: boolean | string;
  item_type?: string;
  product_type?: string;
  stocks?: Array<{ stock_on_hand?: number }>;
};

export type CompositeItemDetail = ItemDetail & {
  mapped_items?: CompositeMappedItem[];
  composite_item_line_items?: CompositeMappedItem[];
  bundle_items?: CompositeMappedItem[];
  line_items?: CompositeMappedItem[];
  items?: CompositeMappedItem[];
};

export type StockStatus = "in-stock" | "low-stock" | "out-of-stock" | "unknown";

export type BomRowType = "master" | "plain" | "sub_bom" | "component";

export type BomReportRow = {
  sourceOrderId: string;
  sourceOrderNumber: string;
  customerName: string;
  orderDate?: string;
  itemId: string;
  parentItemId?: string;
  itemName: string;
  sku: string;
  groupName: string;
  masterGroup: string;
  cfGroup: string;
  cfSubGroup: string;
  cfHeight: string;
  cfWidth: string;
  cfDepth: string;
  cfThickness: string;
  cfFinish: string;
  cfType: string;
  level: number;
  quantityNeeded: number;
  wastePercent: number;
  actualQuantity: number;
  rawStock: number;
  effectiveStock: number;
  deficit: number;
  unit: string;
  status: StockStatus;
  rowType: BomRowType;
  typeLabel: "PACK BOM" | "COMPONENT" | "SUB-BOM" | "ITEM";
  underProfile: boolean;
};

export type ApiErrorBody = {
  error: string;
  detail?: unknown;
};
