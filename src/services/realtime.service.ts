import { Injectable } from '@nestjs/common';
import { NotionService } from './notion.service';

@Injectable()
export class RealtimeService {
  constructor(private readonly notionService: NotionService) {}

  /**
   * Get realtime funding data for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @returns Processed realtime funding data sorted by date in descending order
   */
  async getRealtimeData(user: string) {
    try {
      // Get data from Notion's funding_real_time database, sorted by '日期' in descending order
      const data = await this.notionService.getDatabaseData(user, 'funding_real_time', '日期');
      
      // Process and transform the data as needed
      const processedData = this.notionService.processNotionData(data);
      
      return {
        success: true,
        data: processedData,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error fetching realtime data for user ${user}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }


}
