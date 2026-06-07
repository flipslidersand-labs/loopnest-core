import { PrismaClient } from '@prisma/client';
import { OrganizationRepository } from './OrganizationRepository.js';
import { CustomerRepository } from './CustomerRepository.js';
import { ProductRepository } from './ProductRepository.js';
import { QuoteRepository } from './QuoteRepository.js';
import { QuoteItemRepository } from './QuoteItemRepository.js';
import { UserRepository } from './UserRepository.js';
import { InvoiceRepository } from './InvoiceRepository.js';
import { OutboxRepository } from './OutboxRepository.js';

export class RepositoryContainer {
  private readonly organizationRepo: OrganizationRepository;
  private readonly customerRepo: CustomerRepository;
  private readonly productRepo: ProductRepository;
  private readonly quoteRepo: QuoteRepository;
  private readonly quoteItemRepo: QuoteItemRepository;
  private readonly userRepo: UserRepository;
  private readonly invoiceRepo: InvoiceRepository;
  private readonly outboxRepo: OutboxRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly db: any
  ) {
    this.organizationRepo = new OrganizationRepository(prisma);
    this.customerRepo = new CustomerRepository(prisma);
    this.productRepo = new ProductRepository(prisma);
    this.quoteRepo = new QuoteRepository(db, prisma);
    this.quoteItemRepo = new QuoteItemRepository(prisma);
    this.userRepo = new UserRepository(prisma);
    this.invoiceRepo = new InvoiceRepository(db);
    this.outboxRepo = new OutboxRepository(db);
  }

  get organizations(): OrganizationRepository {
    return this.organizationRepo;
  }

  get customers(): CustomerRepository {
    return this.customerRepo;
  }

  get products(): ProductRepository {
    return this.productRepo;
  }

  get quotes(): QuoteRepository {
    return this.quoteRepo;
  }

  get quoteItems(): QuoteItemRepository {
    return this.quoteItemRepo;
  }

  get users(): UserRepository {
    return this.userRepo;
  }

  get invoices(): InvoiceRepository {
    return this.invoiceRepo;
  }

  get outbox(): OutboxRepository {
    return this.outboxRepo;
  }

  /**
   * Begin a database transaction.
   * Useful for operations that span multiple repositories.
   */
  async beginTransaction<T>(
    callback: (container: RepositoryContainer) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(async (tx: any) => {
      const transactionContainer = new RepositoryContainer(tx as PrismaClient, this.db);
      return callback(transactionContainer);
    });
  }
}
