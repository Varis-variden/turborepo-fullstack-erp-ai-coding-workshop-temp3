import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';

@Module({ imports: [InventoryModule], controllers: [GoodsReceiptsController] })
export class GoodsReceiptsModule {}
