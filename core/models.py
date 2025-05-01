from django.db import models

class Project(models.Model):
    title = models.CharField(max_length=200)
    subtitle = models.CharField(max_length=200)
    description = models.TextField()
    slug = models.SlugField(unique=True) 
    image = models.ImageField(upload_to='images/', blank=True, null=True)

    def __str__(self):
        return self.title
