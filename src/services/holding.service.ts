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
      // Prepare filter for Notion API
      let filter = null;
      
      // Build filter based on status and except parameters
      if (status || except) {
        const filters = [];
        
        // Add status filter if provided
        if (status) {
          const includedStatuses = status.split(',').map(s => s.trim());
          
          // If there's only one status, use a simple filter
          if (includedStatuses.length === 1) {
            filters.push({
              property: '状态',
              select: {
                equals: includedStatuses[0]
              }
            });
          } 
          // If there are multiple statuses, use an OR compound filter
          else if (includedStatuses.length > 1) {
            const statusFilters = includedStatuses.map(statusValue => ({
              property: '状态',
              select: {
                equals: statusValue
              }
            }));
            
            filters.push({
              or: statusFilters
            });
          }
        }
        
        // Add except filter if provided
        if (except) {
          const excludedStatuses = except.split(',').map(s => s.trim());
          
          // For each excluded status, add a filter
          excludedStatuses.forEach(excludedStatus => {
            filters.push({
              property: '状态',
              select: {
                does_not_equal: excludedStatus
              }
            });
          });
        }
        
        // Combine all filters with AND if there are multiple
        if (filters.length === 1) {
          filter = filters[0];
        } else if (filters.length > 1) {
          filter = {
            and: filters
          };
        }
      }
      
      // Get data from Notion's funding_holding database with filter
      const data = await this.notionService.getDatabaseData(
        user, 
        'funding_holding', 
        '进场日期', 
        'descending',
        filter
      );
      
      // Process and transform the data
      const processedData = this.notionService.processNotionData(data);
      
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
