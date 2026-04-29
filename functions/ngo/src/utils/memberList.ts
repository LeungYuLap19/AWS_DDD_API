import mongoose from 'mongoose';

type MemberListItem = {
  userId: string | { toString(): string };
  ngoId: string | { toString(): string };
  user?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: string;
  };
  ngo?: { name?: string };
  ngoCounter?: { ngoPrefix?: string; seq?: number };
};

export async function buildNgoMemberList({
  ngoId,
  search,
  page,
}: {
  ngoId: string;
  search: string;
  page: number;
}) {
  const NgoUserAccess = mongoose.model('NgoUserAccess');
  const limit = 50;
  const skip = (page - 1) * limit;

  const pipeline: Record<string, unknown>[] = [
    {
      $match: {
        ngoId: new mongoose.Types.ObjectId(ngoId),
        isActive: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        let: { userId: '$userId' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$userId'] },
              deleted: false,
            },
          },
          {
            $project: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              email: 1,
              role: 1,
            },
          },
        ],
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $lookup: {
        from: 'ngos',
        let: { ngoId: '$ngoId' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$ngoId'] },
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              registrationNumber: 1,
            },
          },
        ],
        as: 'ngo',
      },
    },
    { $unwind: '$ngo' },
  ];

  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { 'user.firstName': { $regex: search, $options: 'i' } },
          { 'user.lastName': { $regex: search, $options: 'i' } },
          { 'ngo.name': { $regex: search, $options: 'i' } },
          { 'ngo.registrationNumber': { $regex: search, $options: 'i' } },
        ],
      },
    });
  }

  pipeline.push(
    {
      $project: {
        userId: 1,
        ngoId: 1,
        createdAt: 1,
        'user.firstName': 1,
        'user.lastName': 1,
        'user.email': 1,
        'user.role': 1,
        'ngo.name': 1,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'ngo_counters',
              let: { ngoId: '$ngoId' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$ngoId', '$$ngoId'] },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    ngoPrefix: 1,
                    seq: 1,
                  },
                },
              ],
              as: 'ngoCounter',
            },
          },
          {
            $unwind: {
              path: '$ngoCounter',
              preserveNullAndEmptyArrays: true,
            },
          },
        ],
      },
    }
  );

  const [results = { metadata: [], data: [] }] = (await NgoUserAccess.aggregate(
    pipeline as unknown as Parameters<typeof NgoUserAccess.aggregate>[0]
  )
    .allowDiskUse(true)
    .exec()) as Array<{
    metadata?: Array<{ total?: number }>;
    data?: MemberListItem[];
  }>;

  const totalDocs = results.metadata?.[0]?.total || 0;
  const totalPages = Math.ceil(totalDocs / limit) || 1;
  const members = (results.data || []).map((item) => ({
    _id: item.userId,
    firstName: item.user?.firstName ?? '',
    lastName: item.user?.lastName ?? '',
    email: item.user?.email ?? '',
    role: item.user?.role ?? '',
    ngoName: item.ngo?.name ?? '',
    ngoId: item.ngoId,
    ngoPrefix: item.ngoCounter?.ngoPrefix ?? '',
    sequence: item.ngoCounter?.seq?.toString() ?? '',
  }));

  return { members, totalDocs, totalPages };
}
