import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';
import { connectBrowseDB } from '../config/db';
import { response } from '../utils/response';
import {
  BROWSE_DETAIL_PROJECTION,
  BROWSE_LIST_PROJECTION,
  EXCLUDED_SITES,
  PAGE_SIZE,
  escapeRegex,
  isValidObjectId,
  normalizeCsvValues,
  parsePositiveInteger,
  sanitizeBrowseAdoption,
  toErrorResponse,
} from '../utils/helpers';

const AGE_RANGES: Record<string, object> = {
  幼年: { Age: { $lt: 12 } },
  青年: { Age: { $gte: 12, $lte: 36 } },
  成年: { Age: { $gte: 48, $lte: 72 } },
  老年: { Age: { $gt: 84 } },
};

function buildAdoptionListQuery(query: {
  animalTypes?: string[];
  locations?: string[];
  sexes?: string[];
  ages?: string[];
  search?: string;
}) {
  const conditions: Record<string, unknown> & { $and: object[] } = {
    $and: [
      { AdoptionSite: { $nin: EXCLUDED_SITES } },
      { Image_URL: { $exists: true, $ne: '' } },
    ],
  };

  if (query.animalTypes?.length) {
    conditions.Animal_Type = { $in: query.animalTypes };
  }

  if (query.locations?.length) {
    conditions.$and.push({ AdoptionSite: { $in: query.locations } });
  }

  if (query.sexes?.length) {
    conditions.Sex = { $in: query.sexes };
  }

  const ageFilters = (query.ages ?? []).map((age) => AGE_RANGES[age]).filter(Boolean);
  if (ageFilters.length > 0) {
    conditions.$and.push({ $or: ageFilters });
  }

  if (query.search) {
    const safeSearch = escapeRegex(query.search);
    (conditions as Record<string, unknown>).$or = [
      { Breed: { $regex: safeSearch, $options: 'i' } },
      { Animal_Type: { $regex: safeSearch, $options: 'i' } },
      { Remark: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  return conditions;
}

/**
 * GET /pet/adoption
 * Public adoption browse list with filters and pagination.
 */
export async function handleGetAdoptionList(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    const params = ctx.event.queryStringParameters ?? {};
    const locale = typeof params.lang === 'string' ? params.lang : 'zh';
    void locale; // locale is read from queryStringParameters upstream by i18n helpers

    const pageRaw = parsePositiveInteger(params.page);
    if (params.page !== undefined && pageRaw === null) {
      return response.errorResponse(400, 'petAdoption.errors.browse.invalidPage', ctx.event);
    }

    const search =
      typeof params.search === 'string' ? params.search.trim().slice(0, 100) : '';

    if (typeof params.search === 'string' && params.search.trim().length > 100) {
      return response.errorResponse(400, 'petAdoption.errors.browse.invalidSearch', ctx.event);
    }

    const browseQuery = {
      page: pageRaw ?? 1,
      search,
      animalTypes: normalizeCsvValues(params.animal_type),
      locations: normalizeCsvValues(params.location),
      sexes: normalizeCsvValues(params.sex),
      ages: normalizeCsvValues(params.age),
    };

    const browseConn = await connectBrowseDB();
    const Adoption = browseConn.model('Adoption');
    const mongoQuery = buildAdoptionListQuery(browseQuery);
    const totalResult = await Adoption.countDocuments(mongoQuery);
    const maxPage = Math.ceil(totalResult / PAGE_SIZE);
    const page = browseQuery.page;

    const adoptionList = await Adoption.aggregate([
      { $match: mongoQuery },
      {
        $addFields: {
          parsedDate: {
            $convert: {
              input: '$Creation_Date',
              to: 'date',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $sort: { parsedDate: -1, _id: -1 } },
      { $skip: (page - 1) * PAGE_SIZE },
      { $limit: PAGE_SIZE },
      { $project: BROWSE_LIST_PROJECTION },
    ]);

    return response.successResponse(200, ctx.event, {
      message: 'petAdoption.success.browse.listRetrieved',
      adoptionList: adoptionList.map(sanitizeBrowseAdoption),
      maxPage,
      totalResult,
    });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

/**
 * GET /pet/adoption/{id}  (when no auth context — public browse detail)
 * Public adoption browse detail for one adoption-listing pet.
 */
export async function handleGetBrowseDetail(
  ctx: RouteContext,
  adoptionId: string
): Promise<APIGatewayProxyResult> {
  if (!isValidObjectId(adoptionId)) {
    return response.errorResponse(400, 'petAdoption.errors.browse.invalidIdFormat', ctx.event);
  }

  try {
    const browseConn = await connectBrowseDB();
    const Adoption = browseConn.model('Adoption');
    const pet = await Adoption.findOne({ _id: adoptionId })
      .select(BROWSE_DETAIL_PROJECTION)
      .lean();

    if (!pet) {
      return response.errorResponse(404, 'petAdoption.errors.browse.petNotFound', ctx.event);
    }

    return response.successResponse(200, ctx.event, {
      message: 'petAdoption.success.browse.detailRetrieved',
      pet: sanitizeBrowseAdoption(pet),
    });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}
