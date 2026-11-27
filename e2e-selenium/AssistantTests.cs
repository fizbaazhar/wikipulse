using WikiPulse.E2E.Pages;

namespace WikiPulse.E2E;

/// <summary>The e2e back end runs with AI off, so every answer comes from the rules.</summary>
public class AssistantTests : BrowserTest
{
    private DashboardPage _dashboard = null!;

    [SetUp]
    public void OpenAssistant()
    {
        _dashboard = OpenDashboard();
        _dashboard.OpenAssistant();
    }

    [Test]
    public void A_suggested_question_is_answered_from_the_live_data()
    {
        _dashboard.ClickSuggestion("How much of the editing is by bots?");
        Assert.That(_dashboard.LastAnswer(), Does.Contain("were made by bots"));
    }

    [Test]
    public void Questions_about_anything_else_are_declined()
    {
        _dashboard.Ask("What is the capital of France?");
        Assert.That(_dashboard.LastAnswer(), Does.Contain("I can only answer questions about the WikiPulse dashboard"));
    }

    [Test]
    public void A_question_containing_html_is_shown_as_text()
    {
        _dashboard.Ask("<img src=x onerror=\"alert(1)\"> what is trending?");
        _dashboard.LastAnswer();
        Assert.Multiple(() =>
        {
            Assert.That(_dashboard.Questions[^1], Does.Contain("<img src=x"));
            Assert.That(_dashboard.ImagesInAssistant, Is.Zero);
        });
    }
}
