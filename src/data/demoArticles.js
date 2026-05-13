export const demoArticles = [
  {
    id: 'demo-1',
    title: 'Why Housing Supply Changes Rent Pressure',
    slug: 'why-housing-supply-changes-rent-pressure',
    subtitle: 'A concise, sourced-style brief on how added homes can affect affordability debates.',
    summary: 'Housing costs are shaped by local demand, permitting constraints, vacancy rates, and construction timing. This brief separates the core empirical claim from the policy argument.',
    category: 'Policy',
    status: 'published',
    created_at: new Date().toISOString(),
    body: [
      {
        heading: 'The central claim',
        paragraphs: [
          'When a region adds homes more slowly than household demand grows, scarcity tends to show up as higher rents, more crowding, or longer commutes. The persuasive case for supply reform is strongest when it acknowledges that new construction is not the only affordability tool.',
          'A careful argument should distinguish between short-run disruption, long-run market effects, and targeted support for renters who need immediate help.'
        ]
      },
      {
        heading: 'What remains uncertain',
        paragraphs: [
          'The size and timing of rent effects varies by market. Local zoning, interest rates, labor costs, and income growth can change the result, so claims should be framed as probabilistic rather than absolute.'
        ]
      }
    ],
    claims_json: [
      {
        claim: 'Constrained housing supply can contribute to higher rents when demand is strong.',
        type: 'fact',
        confidence: 'high',
        support: 'This is broadly consistent with urban economics literature, though magnitude depends on local conditions.'
      },
      {
        claim: 'Supply reform works best alongside tenant protections and subsidies.',
        type: 'analysis',
        confidence: 'medium',
        support: 'This combines empirical housing-market reasoning with a policy judgment about short-run distributional effects.'
      }
    ],
    charts_json: [
      {
        title: 'Illustrative Supply Gap',
        type: 'bar',
        note: 'Demo data for UI preview only; replace with sourced values in generated articles.',
        data: [
          { label: 'Demand', value: 100 },
          { label: 'Permits', value: 62 },
          { label: 'Built', value: 49 }
        ]
      }
    ],
    sources_json: [
      {
        title: 'Source needed for final publication',
        publisher: 'Demo mode',
        url: '',
        note: 'Generated articles should include real references or explicitly state when a source is needed.'
      }
    ]
  }
];
