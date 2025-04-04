import { Injectable } from '@nestjs/common';
import { NotionService } from './notion.service';

@Injectable()
export class HoldingService {
  constructor(private readonly notionService: NotionService) {}

  /**
   * Get funding holding information for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @param status Optional status(es) to filter holdings (comma-separated, e.g., 'active,pending')
   * @param except Optional status(es) to exclude (comma-separated, e.g., 'closed,pending')
   * @returns Processed funding holding information
   */
  async getHolding(user: string, status?: string, except?: string) {
    try {
      // Get data from Notion's funding_holding database
      const data = await this.notionService.getDatabaseData(user, 'funding_holding');
      
      // Process and transform the data as needed
      let processedData = this.notionService.processNotionData(data);
      
      // Filter by status if provided
      if (status) {
        // Split the status parameter by comma to handle multiple statuses
        const includedStatuses = status.split(',').map(s => s.trim());
        
        processedData = processedData.filter(item => {
          // Keep items whose status is in the included list
          return includedStatuses.includes(item['状态']);
        });
      }
      
      // Filter out excluded statuses if provided
      if (except) {
        // Split the except parameter by comma to handle multiple excluded statuses
        const excludedStatuses = except.split(',').map(s => s.trim());
        
        processedData = processedData.filter(item => {
          // Keep items whose status is not in the excluded list
          return !excludedStatuses.includes(item['状态']);
        });
      }
      
      return {
        success: true,
        data: processedData,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error fetching holding info for user ${user}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
