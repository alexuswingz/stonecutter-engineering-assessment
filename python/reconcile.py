"""Evidence reconciliation: facts in, verified figures and quality checks out.

TypeScript collects facts for a brand and marketplace: the figure in the shipped weekly mart,
every imported report, the single report chosen by the selection SQL, and the publisher's own
current report from data/exports. This module is the one place that judges those facts.
It never opens the database and uses only the standard library.

stdin: one evidence object or a list of them. stdout: {evidence, quality} per input.
"""
import json
import sys
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

MAX_IMPORT_AGE_HOURS = 48
WEEK_NAMES = {'current': 'reporting week', 'previous': 'comparison week'}


def _day(value):
    parsed = date.fromisoformat(value)
    return f'{parsed.day} {parsed:%b}'


def _n(value):
    return f'{value:,}'


def _check(code, week, passed, blocking, title, detail, action=None, report_ids=(), client=None):
    """`detail` is for the reviewer and names internal reports; `client` is the same limitation
    worded for the client report."""
    check = {'code': code, 'week': week, 'passed': passed, 'blocking': blocking,
             'title': title, 'detail': detail, 'reportIds': [r for r in report_ids if r]}
    if not passed:
        if action:
            check['action'] = action
        if client:
            check['clientNote'] = client
    return check


def pct_change(current, previous):
    """Percentage change at two decimals; undefined without a positive baseline."""
    if current is None or previous is None or previous <= 0:
        return None
    return float(((Decimal(current) / Decimal(previous) - 1) * 100).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP))


def reconcile_week(week, label):
    """Returns (checks, verified figure, covers the full week, covered through)."""
    name = WEEK_NAMES[label]
    start, expected_end = week['periodStart'], week['expectedPeriodEnd']
    span = f'{_day(start)} to {_day(expected_end)}'
    selected, publisher, pipeline = week.get('selected'), week.get('publisher'), week.get('pipeline')
    checks = []

    if not selected and not publisher:
        checks.append(_check(
            'report_available', label, False, True, f'No report for the {name}',
            f'No subscription report for {span} was available at the evaluation time. '
            'Missing data is unknown, not zero.',
            action=f'Import the publisher report for {span}, then reopen this review.',
            client=f'No subscription report for {span} was available when this report was prepared.'))
        return checks, None, False, None

    # 1. Which report: ours must be the one the publisher itself lists as current.
    if not publisher:
        checks.append(_check(
            'publisher_current', label, False, True, 'Not in the publisher export',
            f'The publisher export has no report for {span}, so the imported figure of '
            f"{_n(selected['loadedActiveSubscriptions'])} cannot be verified.",
            action=f'Download the publisher export covering {span}, then reopen this review.',
            client=f"The figure for {span} could not be confirmed against the publisher's current report.",
            report_ids=[selected['reportId']]))
    elif not selected:
        checks.append(_check(
            'publisher_current', label, False, True, 'Publisher report not imported',
            f"The publisher lists {publisher['publisherReportId']} as current for {span}, "
            'but no report for this week has been imported.',
            action=f"Import {publisher['publisherReportId']}, then reopen this review.",
            client=f"The figure for {span} could not be confirmed against the publisher's current report.",
            report_ids=[publisher['publisherReportId']]))
    elif selected['publisherReportId'] != publisher['publisherReportId']:
        checks.append(_check(
            'publisher_current', label, False, True, "Not the publisher's current report",
            f"Our import selects {selected['publisherReportId']}, but the publisher lists "
            f"{publisher['publisherReportId']} as current for {span}.",
            action=f"Import {publisher['publisherReportId']}, then reopen this review.",
            client=f"The figure for {span} could not be confirmed against the publisher's current report.",
            report_ids=[selected['reportId'], publisher['publisherReportId']]))
    else:
        checks.append(_check(
            'publisher_current', label, True, True, "Uses the publisher's current report",
            f"{publisher['publisherReportId']} is the report the publisher lists as current for {span}.",
            report_ids=[selected['reportId']]))

    # The publisher export is authoritative; fall back to the import only when it is absent.
    verified = publisher['activeSubscriptions'] if publisher else selected['loadedActiveSubscriptions']
    status = (publisher or selected)['status']
    through = (publisher or selected)['periodEnd']
    source_id = publisher['publisherReportId'] if publisher else selected['publisherReportId']

    # 2. Coverage: only a complete report for the whole week is comparable.
    complete = status == 'complete' and through == expected_end
    if complete:
        checks.append(_check('coverage', label, True, True, 'Covers the full week',
                             f'{source_id} is a complete report for {span}.', report_ids=[source_id]))
    else:
        checks.append(_check(
            'coverage', label, False, True, f'The {name} is incomplete',
            f'The latest report is {status}: it covers {_day(start)} to {_day(through)}, not the full '
            f'week to {_day(expected_end)}. Its {_n(verified)} is a snapshot through {_day(through)}, '
            'not a comparable weekly figure.',
            action=f"Wait for the publisher's complete report for {span}, then reopen this review.",
            client=f"The publisher's latest report covers {_day(start)} to {_day(through)} only. A full-week figure "
                   f'for {span} is not yet available, so no week-over-week comparison is made.',
            report_ids=[source_id]))

    # 3. Load: what we stored must equal the control totals in the report header.
    if publisher and (publisher['offersListed'] != publisher['offerCount']
                      or publisher['offersTotal'] != publisher['activeSubscriptions']):
        checks.append(_check(
            'export_consistent', label, False, True, 'Publisher export does not add up',
            f"{publisher['publisherReportId']} declares {_n(publisher['offerCount'])} offers and "
            f"{_n(publisher['activeSubscriptions'])} subscriptions but lists {_n(publisher['offersListed'])} "
            f"offers totalling {_n(publisher['offersTotal'])}.",
            action='Download the publisher export again and reopen this review.',
            client=f"The publisher's export for {span} is internally inconsistent and is being re-requested.",
            report_ids=[publisher['publisherReportId']]))
    if selected:
        loaded_offers, loaded_total = selected['loadedOfferCount'], selected['loadedActiveSubscriptions']
        expected_offers, expected_total = selected['declaredOfferCount'], selected['declaredActiveSubscriptions']
        if publisher and publisher['publisherReportId'] == selected['publisherReportId']:
            expected_offers, expected_total = publisher['offerCount'], publisher['activeSubscriptions']
        if loaded_offers == expected_offers and loaded_total == expected_total:
            checks.append(_check(
                'load_complete', label, True, True, 'Import matches the control totals',
                f'{_n(loaded_offers)} offers and {_n(loaded_total)} subscriptions loaded, equal to the report header.',
                report_ids=[selected['reportId']]))
        else:
            gap = expected_total - loaded_total
            missing = (f'{_n(gap)} subscriptions are missing from internal data' if gap > 0
                       else f'internal data holds {_n(-gap)} more subscriptions than the header')
            checks.append(_check(
                'load_complete', label, False, True, 'Import does not match the control totals',
                f"{selected['reportId']} loaded {_n(loaded_offers)} of {_n(expected_offers)} offers and "
                f'{_n(loaded_total)} of {_n(expected_total)} subscriptions: {missing}, although the import '
                'was recorded as successful.',
                action=f"Ask for {selected['publisherReportId']} to be re-imported, then reopen this review.",
                client=f"Our internal copy of the publisher's report for {span} is incomplete and is being reloaded. "
                       "Figures in this report are the publisher's own totals.",
                report_ids=[selected['reportId']]))

    # 4. Was the figure in the shipped mart right? Informational: the review reports the source figure.
    if pipeline is None:
        checks.append(_check('pipeline_figure', label, False, False, 'Pipeline has no figure',
                             f'The weekly mart has no row for {span}.'))
    elif pipeline['activeSubscriptions'] == verified:
        checks.append(_check('pipeline_figure', label, True, False, 'Pipeline figure agrees with the source',
                             f'The weekly mart reports {_n(verified)}, the same as {source_id}.'))
    else:
        ids = pipeline['sourceReportIds']
        how = (f"by adding {len(ids)} reports together ({', '.join(ids)}). A report is a snapshot, not an increment"
               if len(ids) > 1 else f"from {', '.join(ids) or 'an unknown report'}")
        checks.append(_check(
            'pipeline_figure', label, False, False, 'Pipeline figure is wrong',
            f"The weekly mart reports {_n(pipeline['activeSubscriptions'])} {how}. The source supports "
            f'{_n(verified)}. This review uses the source figure.',
            report_ids=ids))

    # 5. Would the documented rule (greatest revision wins) have picked a different report?
    reports = week.get('reports') or []
    if selected and reports:
        by_revision = max(reports, key=lambda r: (r['status'] == 'complete', r['periodEnd'], r['revision']))
        if by_revision['reportId'] != selected['reportId']:
            replaced = (f", which the publisher replaced with {by_revision['supersededBy']}"
                        if by_revision.get('supersededBy') else '')
            checks.append(_check(
                'import_order', label, False, False, 'Import revision disagrees with the publisher',
                f"The newest import ({by_revision['reportId']}, revision {by_revision['revision']}) re-loaded "
                f"{by_revision['publisherReportId']}{replaced}. Choosing by revision would report "
                f"{_n(by_revision['loadedActiveSubscriptions'])}; the publisher's current report says {_n(verified)}. "
                'Selection follows the publisher, not our revision number.',
                report_ids=[by_revision['reportId'], selected['reportId']]))

    return checks, verified, complete, through


def reconcile(evidence):
    evidence = dict(evidence)
    checks = []
    for label in ('current', 'previous'):
        week = dict(evidence[label])
        week_checks, verified, complete, through = reconcile_week(week, label)
        week.update(verifiedActiveSubscriptions=verified, verifiedThrough=through, complete=complete)
        evidence[label] = week
        checks.extend(week_checks)
    current, previous = evidence['current'], evidence['previous']

    selected = current.get('selected')
    imported = selected['extractedAt'] if selected else None
    age_hours = ((datetime.fromisoformat(evidence['asOf']) - datetime.fromisoformat(imported)).total_seconds() / 3600
                 if imported else float('inf'))
    if age_hours <= MAX_IMPORT_AGE_HOURS:
        checks.append(_check('freshness', 'current', True, True, 'Import is recent',
                             f'The current import is {age_hours:.0f} hours old at the evaluation time '
                             f'(limit {MAX_IMPORT_AGE_HOURS}).', report_ids=[selected['reportId']]))
    else:
        checks.append(_check(
            'freshness', 'current', False, True, 'Import is stale or missing',
            'No current import is available.' if imported is None else
            f'The current import is {age_hours:.0f} hours old at the evaluation time; the limit is '
            f'{MAX_IMPORT_AGE_HOURS} hours.',
            action='Run the import again, then reopen this review.',
            client=f'The latest data import is more than {MAX_IMPORT_AGE_HOURS} hours old and is being refreshed.',
            report_ids=[selected['reportId']] if selected else []))

    now, before = current['verifiedActiveSubscriptions'], previous['verifiedActiveSubscriptions']
    # Growth is only stated between two complete weekly snapshots.
    comparable = current['complete'] and previous['complete']
    growth = pct_change(now, before) if comparable else None
    if comparable and growth is None:
        checks.append(_check('baseline', 'previous', False, True, 'No baseline for a percentage',
                             'Percentage change is undefined when the comparison week is zero or unavailable.',
                             client='The week before has no subscriptions to compare against, so no percentage change is stated.'))

    evidence['activeSubscriptions'] = now
    evidence['previousSubscriptions'] = before
    evidence['growthPct'] = growth
    pipeline_now, pipeline_before = current.get('pipeline'), previous.get('pipeline')
    evidence['pipelineGrowthPct'] = pct_change(
        pipeline_now['activeSubscriptions'] if pipeline_now else None,
        pipeline_before['activeSubscriptions'] if pipeline_before else None)
    # Internal total of the selected report, and how far it is from the verified figure.
    evidence['sourceTotal'] = selected['loadedActiveSubscriptions'] if selected else None
    evidence['reconciliationDelta'] = (selected['loadedActiveSubscriptions'] - now
                                       if selected and now is not None else None)

    failed = [check for check in checks if check['blocking'] and not check['passed']]
    quality = {'status': 'insufficient' if failed else 'ready',
               'reasons': [f"{check['title']}: {check['detail']}" for check in failed],
               'checks': checks}
    return {'evidence': evidence, 'quality': quality}


if __name__ == '__main__':
    payload = json.load(sys.stdin)
    result = [reconcile(item) for item in payload] if isinstance(payload, list) else reconcile(payload)
    json.dump(result, sys.stdout, allow_nan=False)
