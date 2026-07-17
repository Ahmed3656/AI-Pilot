import {
  DeepPartial,
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export abstract class BaseRepository<
  TEntity extends ObjectLiteral & { id: string },
> {
  protected constructor(protected readonly repository: Repository<TEntity>) {}

  async create(data: DeepPartial<TEntity>): Promise<TEntity> {
    return this.repository.save(this.repository.create(data));
  }

  async findById(id: string): Promise<TEntity | null> {
    return this.repository.findOneBy({ id } as FindOptionsWhere<TEntity>);
  }

  async findOne(options: FindOneOptions<TEntity>): Promise<TEntity | null> {
    return this.repository.findOne(options);
  }

  async find(options?: FindManyOptions<TEntity>): Promise<TEntity[]> {
    return this.repository.find(options);
  }

  async paginate(page = 1, pageSize = 20): Promise<Page<TEntity>> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, Math.min(100, pageSize));
    const [items, total] = await this.repository.findAndCount({
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    });
    return {
      items,
      total,
      page: safePage,
      pageSize: safePageSize,
      pages: Math.ceil(total / safePageSize),
    };
  }

  runInTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.repository.manager.transaction(work);
  }
}
