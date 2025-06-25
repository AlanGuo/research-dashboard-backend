import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Timeout } from '@nestjs/schedule';
import { BinanceVolumeBacktestService } from '../services/binance-volume-backtest.service';
import { ConfigService } from '../config/config.service';
import { sendEmail } from '../utils/util';
import { VolumeBacktestParamsDto } from '../dto/volume-backtest-params.dto';

@Injectable()
export class VolumeBacktestSchedulerTask {
  private readonly logger = new Logger(VolumeBacktestSchedulerTask.name);

  constructor(
    private readonly volumeBacktestService: BinanceVolumeBacktestService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 定时任务：每天UTC时间 00:00:10, 08:00:10, 16:00:10 执行异步回测
   */
  // @Timeout(1000) // 初始延迟1秒执行
  @Cron('10 0 0,8,16 * * *', { timeZone: 'UTC' })
  async executeScheduledBacktest() {
    this.logger.log('开始执行定时回测任务');

    try {
      // 1. 检查是否有正在执行的异步回测任务
      const runningTasks = await this.volumeBacktestService.getAsyncBacktestTasks(100, 0);
      const hasRunningTask = runningTasks.tasks.some(task => 
        task.status === 'running' || task.status === 'pending'
      );

      if (hasRunningTask) {
        this.logger.warn('检测到有正在执行的异步回测任务，跳过本次定时执行');
        
        // 发送跳过执行通知邮件
        await this.sendSkipNotification();
        return;
      }

      // 2. 计算回测时间段
      const timeRange = await this.calculateBacktestTimeRange();
      
      if (!timeRange) {
        this.logger.warn('无法计算有效的回测时间段，跳过本次执行');
        return;
      }

      // 3. 构建回测参数
      const params: VolumeBacktestParamsDto = {
        startTime: timeRange.startTime.toISOString(),
        endTime: timeRange.endTime.toISOString(),
        limit: 30,
        minVolumeThreshold: 400000,
        minHistoryDays: 365,
        granularityHours: 8,
        quoteAsset: 'USDT',
      };

      this.logger.log(`开始执行定时回测，参数: ${JSON.stringify(params)}`);

      // 4. 启动异步回测
      const result = await this.volumeBacktestService.startAsyncVolumeBacktest(params);
      
      this.logger.log(`定时回测任务启动成功，任务ID: ${result.taskId}`);

    } catch (error) {
      this.logger.error('定时回测任务执行失败:', error);
      
      // 发送错误通知邮件
      await this.sendErrorNotification(error);
    }
  }

  /**
   * 计算回测时间段
   */
  private async calculateBacktestTimeRange(): Promise<{ startTime: Date; endTime: Date } | null> {
    try {
      // 1. 获取最新的回测记录 - 优化查询，只获取一条最新记录
      const latestBacktestResults = await this.volumeBacktestService.getLatestBacktestResult();

      // 2. 计算startTime
      let startTime: Date;
      
      if (latestBacktestResults) {
        // 从最新记录的timestamp + 8小时开始
        const latestTimestamp = latestBacktestResults.timestamp;
        startTime = new Date(latestTimestamp.getTime() + 8 * 60 * 60 * 1000);
      } else {
        // 如果没有历史数据，从2020-01-01开始
        startTime = new Date('2020-01-01T00:00:00.000Z');
      }

      // 3. 计算endTime：距离当前时间最近的下一个00:00, 08:00或16:00 (UTC)
      const endTime = this.calculateNextScheduledTime();

      // 4. 验证时间范围
      if (startTime >= endTime) {
        this.logger.warn(`计算的startTime(${startTime.toISOString()}) >= endTime(${endTime.toISOString()})，跳过执行`);
        return null;
      }

      return { startTime, endTime };

    } catch (error) {
      this.logger.error('计算回测时间段失败:', error);
      throw error;
    }
  }

  /**
   * 计算距离当前时间最近的下一个调度时间点 (00:00, 08:00, 16:00 UTC)
   */
  private calculateNextScheduledTime(): Date {
    const now = new Date();
    const currentUTCHour = now.getUTCHours();
    
    // 找到下一个调度时间点
    let nextHour: number;
    
    if (currentUTCHour < 8) {
      nextHour = 8;
    } else if (currentUTCHour < 16) {
      nextHour = 16;
    } else {
      nextHour = 24; // 明天的00:00
    }

    const nextTime = new Date(now);
    nextTime.setUTCHours(nextHour === 24 ? 0 : nextHour, 0, 0, 0);
    
    // 如果是明天的00:00，需要加一天
    if (nextHour === 24) {
      nextTime.setUTCDate(nextTime.getUTCDate() + 1);
    }

    return nextTime;
  }

  /**
   * 发送错误通知邮件
   */
  private async sendErrorNotification(error: any) {
    try {
      const errorRecipient = this.configService.get<string>('email.errorNotificationRecipient');
      
      if (!errorRecipient) {
        this.logger.warn('未配置错误通知邮件收件人，跳过邮件发送');
        return;
      }

      const subject = '[BTCDOM2]定时回测任务执行失败通知';
      const content = `
定时回测任务执行失败，详情如下：

时间：${new Date().toISOString()}
错误信息：${error.message || error}
错误堆栈：${error.stack || '无'}

请及时检查系统状态。
      `;

      await sendEmail({
        address: errorRecipient,
        subject,
        content,
        configService: this.configService,
      });

      this.logger.log(`错误通知邮件已发送至: ${errorRecipient}`);

    } catch (emailError) {
      this.logger.error('发送错误通知邮件失败:', emailError);
    }
  }

  /**
   * 发送跳过执行通知邮件
   */
  private async sendSkipNotification() {
    try {
      const errorRecipient = this.configService.get<string>('email.errorNotificationRecipient');
      
      if (!errorRecipient) {
        this.logger.warn('未配置错误通知邮件收件人，跳过邮件发送');
        return;
      }

      const subject = '[BTCDOM2]定时回测任务跳过执行通知';
      const content = `
定时回测任务跳过执行，详情如下：

时间：${new Date().toISOString()}
原因：检测到有正在执行的异步回测任务
状态：已跳过本次定时执行

系统将在下一个调度时间点重新尝试执行。
      `;

      await sendEmail({
        address: errorRecipient,
        subject,
        content,
        configService: this.configService,
      });

      this.logger.log(`跳过执行通知邮件已发送至: ${errorRecipient}`);

    } catch (emailError) {
      this.logger.error('发送跳过执行通知邮件失败:', emailError);
    }
  }
}
