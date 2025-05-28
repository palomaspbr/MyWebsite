# core/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('', views.list_projects, name='index'),
    path('customprojects/<slug:slug>/', views.customproject_detail, name='customproject_detail'),
    path('cookie', views.cookie, name='cookie'),
]