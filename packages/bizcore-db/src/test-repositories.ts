import { initializeDatabaseServices } from './factory.js';

async function testRepositories() {
  console.log('🧪 Testing Repository Layer...\n');

  const { repos, close } = await initializeDatabaseServices();

  try {
    // Test Organizations
    console.log('📦 Testing OrganizationRepository...');
    const orgs = await repos.organizations.findAll({ take: 3 });
    console.log(`   ✅ Found ${orgs.length} organizations`);
    console.log(`   📋 Sample: ${orgs[0]?.name}`);

    // Test Customers
    console.log('\n📦 Testing CustomerRepository...');
    const customers = await repos.customers.findAll({ take: 5 });
    console.log(`   ✅ Found ${customers.length} customers`);
    if (customers.length > 0) {
      console.log(`   📋 Sample: ${customers[0]?.name}`);
    }

    // Test Products
    console.log('\n📦 Testing ProductRepository...');
    const products = await repos.products.findAll({ take: 5 });
    console.log(`   ✅ Found ${products.length} products`);
    if (products.length > 0) {
      console.log(`   📋 Sample: ${products[0]?.name} (SKU: ${products[0]?.sku})`);
    }

    // Test Quotes
    console.log('\n📦 Testing QuoteRepository...');
    const quotes = await repos.quotes.findAll({ take: 5 });
    console.log(`   ✅ Found ${quotes.length} quotes`);
    if (quotes.length > 0) {
      console.log(`   📋 Sample: ${quotes[0]?.quoteNumber} - ${quotes[0]?.status}`);

      // Test findWithItems
      const quoteWithItems = await repos.quotes.findWithItems(quotes[0].id);
      if (quoteWithItems?.items) {
        console.log(`   📋 Quote has ${quoteWithItems.items.length} line items`);
      }
    }

    // Test Users
    console.log('\n📦 Testing UserRepository...');
    const users = await repos.users.findAll({ take: 5 });
    console.log(`   ✅ Found ${users.length} users`);
    if (users.length > 0) {
      console.log(`   📋 Sample: ${users[0]?.name} (${users[0]?.role})`);
    }

    // Test counts
    console.log('\n📊 Data Summary:');
    const orgCount = await repos.organizations.count();
    const customerCount = await repos.customers.count();
    const productCount = await repos.products.count();
    const userCount = await repos.users.count();
    const quoteCount = await repos.quotes.count();

    console.log(`   Organizations: ${orgCount}`);
    console.log(`   Customers: ${customerCount}`);
    console.log(`   Products: ${productCount}`);
    console.log(`   Users: ${userCount}`);
    console.log(`   Quotes: ${quoteCount}`);

    console.log('\n✅ All repositories working correctly!');
  } catch (err) {
    console.error('\n❌ Error:', err);
    process.exit(1);
  } finally {
    await close();
  }
}

testRepositories();
