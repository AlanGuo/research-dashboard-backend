import { Injectable } from '@nestjs/common';
import { NotionService } from './notion.service';

@Injectable()
export class BaseinfoService {
  constructor(private readonly notionService: NotionService) {}

  /**
   * Get base price information for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @returns Processed base price information
   */
  async getBaseInfo(user: string) {
    try {
      // Get data from Notion's funding_base_info database
      const data = await this.notionService.getDatabaseData(user, 'funding_base_info');
      
      // Process and transform the data as needed
      const processedData = this.notionService.processNotionData(data);
      
      return {
        success: true,
        data: processedData,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error fetching base info for user ${user}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }


}
