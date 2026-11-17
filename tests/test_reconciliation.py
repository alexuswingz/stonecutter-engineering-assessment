"""Quality-gate tests. Evidence is built in memory; no database or bundled figures are involved."""
import copy

from reconcile import pct_change, reconcile


def report(report_id, publisher_id, total, *, status='complete', period_end, revision=1, offers=120,
           extracted_at='2026-10-06T03:00:00Z', loaded_total=None, loaded_offers=None, superseded_by=None):
    return dict(reportId=report_id, publisherReportId=publisher_id, revision=revision, status=status,
                periodEnd=period_end, generatedAt='2026-10-06T02:00:00Z', extractedAt=extracted_at,
                declaredOfferCount=offers, declaredActiveSubscriptions=total,
                loadedOfferCount=offers if loaded_offers is None else loaded_offers,
                loadedActiveSubscriptions=total if loaded_total is None else loaded_total,
                usedByPipeline=True, selected=True, supersededBy=superseded_by, knownToPublisher=True)


def published(publisher_id, total, *, status='complete', period_end, offers=120):
    return dict(publisherReportId=publisher_id, status=status, periodEnd=period_end,
                generatedAt='2026-10-06T02:00:00Z', offerCount=offers, activeSubscriptions=total,
                offersListed=offers, offersTotal=total)


def week(start, end, total, *, pipeline_total=None, report_id='r', publisher_id='p'):
    selected = report(report_id, publisher_id, total, period_end=end)
    return dict(periodStart=start, expectedPeriodEnd=end,
                pipeline=dict(activeSubscriptions=total if pipeline_total is None else pipeline_total,
                              sourceReportIds=[report_id], sourceComplete=True, sourcePeriodEnd=end),
                selected=selected, publisher=published(publisher_id, total, period_end=end), reports=[selected])


def healthy(current=115, previous=100):
    """Two complete, reconciled weekly snapshots: the control case."""
    return dict(asOf='2026-10-06T12:00:00Z', periodStart='2026-09-28', expectedPeriodEnd='2026-10-04',
                current=week('2026-09-28', '2026-10-04', current, report_id='cur', publisher_id='pub-cur'),
                previous=week('2026-09-21', '2026-09-27', previous, report_id='prev', publisher_id='pub-prev'))


def failed(result):
    return {(check['code'], check['week']) for check in result['quality']['checks'] if not check['passed']}


def test_complete_comparable_snapshots_are_ready():
    result = reconcile(healthy())
    assert result['evidence']['growthPct'] == 15
    assert result['evidence']['activeSubscriptions'] == 115
    assert result['evidence']['sourceTotal'] == 115
    assert result['evidence']['reconciliationDelta'] == 0
    assert result['quality']['status'] == 'ready'
    assert failed(result) == set()


def test_partial_current_week_is_shown_but_not_compared():
    evidence = healthy()
    partial = report('cur', 'pub-cur', 108, status='partial', period_end='2026-10-02')
    evidence['current'].update(selected=partial, reports=[partial],
                               publisher=published('pub-cur', 108, status='partial', period_end='2026-10-02'))
    evidence['current']['pipeline']['activeSubscriptions'] = 108
    result = reconcile(evidence)
    assert result['quality']['status'] == 'insufficient'
    assert failed(result) == {('coverage', 'current')}
    assert result['evidence']['activeSubscriptions'] == 108       # the snapshot can still be shown
    assert result['evidence']['current']['verifiedThrough'] == '2026-10-02'
    assert result['evidence']['growthPct'] is None                # but never as weekly growth


def test_summed_pipeline_figure_is_reported_against_the_source():
    evidence = healthy()
    evidence['current']['pipeline'].update(activeSubscriptions=330, sourceReportIds=['a', 'b', 'cur'])
    result = reconcile(evidence)
    assert ('pipeline_figure', 'current') in failed(result)
    assert result['evidence']['pipelineGrowthPct'] == 230        # what the pipeline claimed
    assert result['evidence']['growthPct'] == 15                 # what the source supports
    assert result['quality']['status'] == 'ready'                # the corrected figure is usable


def test_truncated_import_blocks_and_the_publisher_total_is_used():
    evidence = healthy()
    evidence['previous']['selected'].update(loadedOfferCount=100, loadedActiveSubscriptions=83)
    evidence['previous']['pipeline']['activeSubscriptions'] = 83
    result = reconcile(evidence)
    assert result['quality']['status'] == 'insufficient'
    assert ('load_complete', 'previous') in failed(result)
    assert result['evidence']['previousSubscriptions'] == 100    # publisher control total, not the 83 loaded
    assert result['evidence']['growthPct'] == 15


def test_report_other_than_the_publishers_current_one_blocks():
    evidence = healthy()
    evidence['current']['publisher'] = published('pub-newer', 104, period_end='2026-10-04')
    result = reconcile(evidence)
    assert ('publisher_current', 'current') in failed(result)
    assert result['quality']['status'] == 'insufficient'
    assert result['evidence']['activeSubscriptions'] == 104


def test_higher_revision_of_a_superseded_report_is_flagged():
    evidence = healthy()
    stale = report('cur-reimport', 'pub-old', 130, period_end='2026-10-04', revision=9, superseded_by='pub-cur')
    stale.update(selected=False)
    evidence['current']['reports'].append(stale)
    result = reconcile(evidence)
    assert ('import_order', 'current') in failed(result)
    assert result['evidence']['activeSubscriptions'] == 115      # revision does not override the publisher
    assert result['quality']['status'] == 'ready'


def test_missing_week_is_unknown_not_zero():
    evidence = healthy()
    evidence['previous'].update(selected=None, publisher=None, pipeline=None, reports=[])
    result = reconcile(evidence)
    assert result['evidence']['previousSubscriptions'] is None
    assert result['evidence']['growthPct'] is None
    assert ('report_available', 'previous') in failed(result)
    assert result['quality']['status'] == 'insufficient'


def test_stale_or_missing_import_is_visible():
    stale = healthy()
    stale['current']['selected']['extractedAt'] = '2026-10-04T11:59:00Z'
    assert ('freshness', 'current') in failed(reconcile(stale))
    boundary = healthy()
    boundary['current']['selected']['extractedAt'] = '2026-10-04T12:00:00Z'   # exactly 48 hours
    assert reconcile(boundary)['quality']['status'] == 'ready'
    missing = healthy()
    missing['current'].update(selected=None, reports=[])
    assert reconcile(missing)['quality']['status'] == 'insufficient'


def test_zero_baseline_has_no_percentage_growth():
    result = reconcile(healthy(previous=0))
    assert result['evidence']['growthPct'] is None
    assert result['quality']['status'] == 'insufficient'
    assert pct_change(5, None) is None


def test_input_is_not_mutated_and_rounding_is_half_up():
    evidence = healthy(current=100125, previous=100000)
    before = copy.deepcopy(evidence)
    assert reconcile(evidence)['evidence']['growthPct'] == 0.13   # 0.125 rounds half up
    assert evidence == before
