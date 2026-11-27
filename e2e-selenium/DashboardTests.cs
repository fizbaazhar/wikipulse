using WikiPulse.E2E.Pages;

namespace WikiPulse.E2E;

/// <summary>
/// The back end replays the recorded sample once, with AI off, so what is on
/// screen is the same on every run.
/// </summary>
public class DashboardTests : BrowserTest
{
    private DashboardPage _dashboard = null!;

    [SetUp]
    public void SignIn() => _dashboard = OpenDashboard();

    [Test]
    public void The_header_shows_the_connection_and_the_key_numbers()
    {
        Assert.That(_dashboard.ConnectionStatus, Does.Contain("Replay").IgnoreCase); // upper-cased by CSS
        // Labels are upper-cased by CSS, and Selenium reads the text as shown.
        var labels = _dashboard.KpiLabels.Select(l => l.ToLowerInvariant());
        Assert.That(labels, Is.SupersetOf(new[] { "edits / min", "by bots", "wikis active", "flagged" }));
    }

    [Test]
    public void The_ten_most_edited_pages_are_ranked_high_to_low()
    {
        var counts = _dashboard.TopCounts;
        Assert.Multiple(() =>
        {
            Assert.That(_dashboard.TopPages, Has.Count.EqualTo(10));
            Assert.That(_dashboard.TopPages[0].Text, Does.Contain("Artificial intelligence"));
            Assert.That(counts, Is.Ordered.Descending);
        });
    }

    [Test]
    public void The_feed_starts_paused_and_can_go_live()
    {
        Assert.That(_dashboard.FeedIsPaused, Is.True, "the feed should start paused");
        _dashboard.GoLive();
        WaitFor(_ => !_dashboard.FeedIsPaused, "the feed to go live");
        _dashboard.Pause();
        WaitFor(_ => _dashboard.FeedIsPaused, "the feed to pause again");
    }

    [Test]
    public void Filtering_by_wiki_narrows_the_whole_dashboard()
    {
        _dashboard.FilterByWiki("frwiki");
        WaitFor(_ => _dashboard.FeedWikis.SetEquals(new[] { "frwiki" }), "only French edits in the feed");
        Assert.That(_dashboard.SelectedWiki, Is.EqualTo("frwiki"));

        _dashboard.FilterByWiki("");
        WaitFor(_ => _dashboard.FeedWikis.Count > 1, "edits from every wiki again");
    }

    [Test]
    public void Attacks_hidden_in_edit_summaries_are_flagged_and_shown_as_plain_text()
    {
        var panel = _dashboard.FlaggedPanelText;
        Assert.Multiple(() =>
        {
            Assert.That(panel, Does.Contain("edit summary contains HTML/script code"));
            Assert.That(panel, Does.Contain("edit summary contains instructions aimed at automated moderation"));
            Assert.That(panel, Does.Contain("<script>alert(\"xss\")</script>"), "the payload is visible as text");
            Assert.That(_dashboard.InjectedImages, Is.Zero, "nothing from the payload was injected");
        });
        // BrowserTest.StopBrowser also fails the test if anything called alert().
    }
}
