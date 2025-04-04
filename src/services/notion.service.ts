import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config';
import { Client } from '@notionhq/client';

@Injectable()
export class NotionService {
  private readonly notionClient: Client;

  constructor(private configService: ConfigService) {
    this.notionClient = new Client({
      auth: this.configService.get<string>('notion.api_key'),
    });
  }

  /**
   * Get database data from Notion based on user and database type
   * @param user User identifier (e.g., 'pumpkin')
   * @param databaseType Type of database to query (e.g., 'funding_base_info', 'funding_real_time')
   * @param sortField Optional field to sort by (default is '日期' for realtime data)
   * @returns Database query results
   */
  async getDatabaseData(user: string, databaseType: string, sortField?: string): Promise<any> {
    try {
      // Get the database ID from config based on user and database type
      const databaseId = this.configService.get<string>(`notion.user.${user}.${databaseType}`);
      
      if (!databaseId) {
        throw new Error(`Database ID not found for user ${user} and type ${databaseType}`);
      }

      // Set default sort field for funding_real_time database
      if (databaseType === 'funding_real_time' && !sortField) {
        sortField = '日期';
      }

      // Prepare query parameters
      const queryParams: any = {
        database_id: databaseId,
      };

      // Add sorting if a sort field is specified
      if (sortField) {
        queryParams.sorts = [
          {
            property: sortField,
            direction: 'descending',
          },
        ];
      }

      // Query the database with sorting
      const response = await this.notionClient.databases.query(queryParams);

      return response.results;
    } catch (error) {
      console.error('Error fetching Notion database:', error);
      throw error;
    }
  }

  /**
   * Process and transform Notion database results
   * @param notionData Raw data from Notion API
   * @returns Processed data
   */
  processNotionData(notionData: any[]) {
    // Transform Notion's response format into a more usable structure
    return notionData.map(item => {
      const properties = item.properties;
      
      // Extract relevant properties from Notion response
      // This will need to be adjusted based on your actual Notion database structure
      const processedItem: any = {};
      
      // Iterate through properties and extract values based on their type
      Object.keys(properties).forEach(key => {
        const property = properties[key];
        
        // Extract value based on property type
        switch (property.type) {
          case 'title':
            processedItem[key] = property.title.map(t => t.plain_text).join('');
            break;
          case 'rich_text':
            processedItem[key] = property.rich_text.map(t => t.plain_text).join('');
            break;
          case 'number':
            processedItem[key] = property.number;
            break;
          case 'select':
            processedItem[key] = property.select?.name;
            break;
          case 'multi_select':
            processedItem[key] = property.multi_select.map(s => s.name);
            break;
          case 'date':
            processedItem[key] = property.date?.start;
            break;
          case 'checkbox':
            processedItem[key] = property.checkbox;
            break;
          default:
            processedItem[key] = null;
        }
      });
      
      return processedItem;
    });
  }
}
