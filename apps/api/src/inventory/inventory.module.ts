import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [InventoryController],
  providers: [StockService],
  exports: [StockService],
})
export class InventoryModule {}
