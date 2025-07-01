/**
 * 测试btcdom2策略表现API的脚本
 * 运行方式: node test-btcdom2-api.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:4001/v1/btcdom2/performance';

async function testAPI() {
  console.log('开始测试btcdom2策略表现API...\n');

  try {
    // 测试1: 获取所有数据
    console.log('1. 测试获取所有数据 (限制10条)');
    const allDataResponse = await axios.get(`${BASE_URL}?limit=10`);
    console.log(`状态码: ${allDataResponse.status}`);
    console.log(`数据条数: ${allDataResponse.data.count}`);
    if (allDataResponse.data.data.length > 0) {
      console.log('第一条数据示例:');
      console.log(JSON.stringify(allDataResponse.data.data[0], null, 2));
    }
    console.log('✅ 测试1通过\n');

    // 测试2: 获取最新数据
    console.log('2. 测试获取最新数据');
    const latestResponse = await axios.get(`${BASE_URL}/latest?count=3`);
    console.log(`状态码: ${latestResponse.status}`);
    console.log(`数据条数: ${latestResponse.data.count}`);
    console.log('✅ 测试2通过\n');

    // 测试3: 获取统计信息
    console.log('3. 测试获取统计信息');
    const statsResponse = await axios.get(`${BASE_URL}/statistics`);
    console.log(`状态码: ${statsResponse.status}`);
    console.log('统计信息:');
    console.log(JSON.stringify(statsResponse.data.data, null, 2));
    console.log('✅ 测试3通过\n');

    // 测试4: 按时间范围查询
    console.log('4. 测试按时间范围查询');
    const timeRangeResponse = await axios.get(`${BASE_URL}/by-market-timestamp`, {
      params: {
        startTimestamp: '2025-06-28T00:00:00.000Z',
        endTimestamp: '2025-06-30T23:59:59.999Z'
      }
    });
    console.log(`状态码: ${timeRangeResponse.status}`);
    console.log(`数据条数: ${timeRangeResponse.data.count}`);
    console.log('✅ 测试4通过\n');

    // 测试5: 按日期范围查询
    console.log('5. 测试按日期范围查询');
    const dateRangeResponse = await axios.get(`${BASE_URL}`, {
      params: {
        startDate: '2025-06-29T00:00:00.000Z',
        endDate: '2025-06-29T23:59:59.999Z',
        limit: 5
      }
    });
    console.log(`状态码: ${dateRangeResponse.status}`);
    console.log(`数据条数: ${dateRangeResponse.data.count}`);
    console.log('✅ 测试5通过\n');

    console.log('🎉 所有API测试通过！');

  } catch (error) {
    console.error('❌ API测试失败:');
    if (error.response) {
      console.error(`状态码: ${error.response.status}`);
      console.error(`错误信息: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`错误信息: ${error.message}`);
    }
  }
}

// 运行测试
testAPI();
