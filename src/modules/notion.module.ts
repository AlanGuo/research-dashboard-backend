import { Module } from "@nestjs/common";
import { NotionService } from "../services/notion.service";
import { ConfigModule } from "../config";

@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [NotionService],
  exports: [NotionService],
})
export class NotionModule {}
