import mongoose from 'mongoose';
import { ProductListSchema } from '../models/ProductList';
import { ProductLogSchema } from '../models/ProductLog';
import { ShopInfoSchema } from '../models/ShopInfo';
import { PtagProductSchema } from '../models/PtagProduct';

export function ensureProductListModel() {
  return mongoose.models.ProductList || mongoose.model('ProductList', ProductListSchema, 'product');
}

export function ensureProductLogModel() {
  return mongoose.models.ProductLog || mongoose.model('ProductLog', ProductLogSchema, 'product_log');
}

export function ensureShopInfoModel() {
  return mongoose.models.ShopInfo || mongoose.model('ShopInfo', ShopInfoSchema, 'shopInfo');
}

export function ensurePtagProductModel() {
  return mongoose.models.PtagProduct || mongoose.model('PtagProduct', PtagProductSchema, 'ptagProduct');
}
