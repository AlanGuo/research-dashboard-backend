import { Injectable } from '@nestjs/common';
import { NotionService } from './notion.service';

@Injectable()
export class ChangeService {
  constructor(private readonly notionService: NotionService) {}

  /**
   * Get change data for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @returns Processed change data sorted by date in descending order
   */
  async getChangeData(user: string) {
    try {
      // Get data from Notion's funding_change database
      const data = await this.notionService.getDatabaseData(user, 'funding_change');
      
      // Process and transform the data as needed
      const processedData = this.notionService.processNotionData(data);
      
      return {
        success: true,
        data: processedData,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error fetching change data for user ${user}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }


}
