namespace WikiPulse.E2E;

public class LoginTests : BrowserTest
{
    [Test]
    public void The_dashboard_is_closed_without_signing_in()
    {
        Driver.Navigate().GoToUrl($"{BaseUrl}/dashboard");
        WaitFor(d => new Uri(d.Url).AbsolutePath == "/login", "a redirect to the login page");
        Assert.That(new Pages.LoginPage(Driver, this).Heading, Is.EqualTo("Hello! Let's get started"));
    }

    [Test]
    public void A_wrong_password_is_refused()
    {
        var login = OpenLogin();
        login.TrySignIn(User, "wrong-password");
        Assert.Multiple(() =>
        {
            Assert.That(login.Error, Is.EqualTo("Wrong username or password."));
            Assert.That(new Uri(Driver.Url).AbsolutePath, Is.EqualTo("/login"));
        });
    }

    [Test]
    public void Signing_in_opens_the_dashboard_and_signing_out_closes_it()
    {
        var dashboard = OpenDashboard();
        Driver.Navigate().Refresh(); // the session survives a reload
        dashboard.WaitUntilLoaded();
        Assert.That(new Uri(Driver.Url).AbsolutePath, Is.EqualTo("/dashboard"));

        dashboard.SignOut();
        Driver.Navigate().GoToUrl($"{BaseUrl}/dashboard");
        WaitFor(d => new Uri(d.Url).AbsolutePath == "/login", "the login page after signing out");
    }
}
